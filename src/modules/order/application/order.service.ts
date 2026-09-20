import mongoose from "mongoose";
import { Order as OrderModel } from "../infrastructure/models/order.model";
import { WebhookLog } from "../infrastructure/models/webhook-log.model";
import { Product } from "../../product/infrastructure/models/product.model";
import { ProductVariant } from "../../product/infrastructure/models/product-variant.model";
import { Shop } from "../../product/infrastructure/models/shop.model";
import { Design } from "../../design/infrastructure/models/design.model";
import { notificationService } from "../../notification";
import { dispatchToPrinter } from "./printer-dispatch.service";
import { PromotionService } from "../../promotion/application/promotion.service";
import { Review } from "../infrastructure/models/review.model";
import { OrderResponse, DEFAULT_SHIPPING_FEE, PLATFORM_FEE_RATE, PAYMENT_METHODS, SHIPPING_CARRIERS, } from "../types";
import { mapDbOrderToResponse } from "../infrastructure/dto/order.dto";
import { byCodeOrId, dec, num, toBuyerObjectId } from "../utils";


export class OrdersService {

  static async createOrder(
    buyerId: string,
    payload: any,
  ): Promise<OrderResponse> {
    const buyerObjectId = toBuyerObjectId(buyerId);

    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) throw new Error("Order phải có ít nhất 1 sản phẩm");

    const address = payload.shippingAddress || payload.shipping_address;
    if (
      !address?.recipient_name ||
      !address?.phone ||
      !address?.address_detail
    ) {
      throw new Error("Thiếu địa chỉ giao hàng");
    }

    let shopId: mongoose.Types.ObjectId | null = null;
    const orderItems: any[] = [];
    let subtotal = 0;
    let hasPodItem = false;

    for (const it of items) {
      if (!mongoose.Types.ObjectId.isValid(it.productId)) {
        throw new Error(`Sản phẩm ${it.productId} không hợp lệ`);
      }
      const product = await Product.findById(it.productId);
      if (!product) throw new Error(`Sản phẩm ${it.productId} không tồn tại`);
      if (
        product.listing_status === "INACTIVE" ||
        product.listing_status === "EXPIRED"
      ) {
        throw new Error(`Sản phẩm "${product.title}" hiện không bán`);
      }

      let variant = null;
      if (it.variantId && mongoose.Types.ObjectId.isValid(it.variantId)) {
        variant = await ProductVariant.findOne({
          _id: it.variantId,
          product_id: product._id,
        });
        if (!variant)
          throw new Error(
            `Biến thể ${it.variantId} không thuộc sản phẩm "${product.title}"`,
          );
      } else {
        variant = await ProductVariant.findOne({
          product_id: product._id,
          is_active: true,
        });
      }
      if (!variant)
        throw new Error(`Sản phẩm "${product.title}" chưa có biến thể để bán`);
      if (variant.is_active === false)
        throw new Error(`Biến thể của "${product.title}" đã ngừng bán`);

      const qty = Math.max(1, Number(it.quantity) || 1);
      if (
        typeof variant.stock_quantity === "number" &&
        variant.stock_quantity < qty
      ) {
        throw new Error(
          `Sản phẩm "${product.title}" chỉ còn ${variant.stock_quantity} sản phẩm`,
        );
      }

      if (shopId && shopId.toString() !== product.shop_id.toString()) {
        throw new Error(
          "Đơn hàng chỉ hỗ trợ 1 shop mỗi lần (MVP). Vui lòng tách đơn theo shop.",
        );
      }
      shopId = product.shop_id;
      if (product.product_type === "POD_TEMPLATE") hasPodItem = true;

      subtotal += num(variant.retail_price) * qty;

      const placement = product.design_placements?.[0];
      let designUrl: string | undefined;
      if (placement?.design_id) {
        const design = await Design.findById(placement.design_id).lean();
        designUrl = design?.file_url;
      }

      orderItems.push({
        product_id: product._id,
        variant_id: variant._id,
        title: product.title,
        color: variant.color,
        size: variant.size,
        quantity: qty,
        base_cost: variant.base_cost,
        retail_price: variant.retail_price,
        image: (() => {
          // Ưu tiên ảnh Cloudinary/http đầy đủ từ product.images
          const productImg = product.images?.[0];
          const mockupImg = variant.mockup_image;
          if (productImg && (productImg.startsWith('http://') || productImg.startsWith('https://'))) {
            return productImg;
          }
          if (mockupImg && (mockupImg.startsWith('http://') || mockupImg.startsWith('https://'))) {
            return mockupImg;
          }
          // Fallback: dùng bất kỳ cái nào có giá trị
          return productImg || mockupImg;
        })(),
        design_file_url: designUrl,
        provider_sku: variant.provider_sku || variant.sku,
        custom_notes: JSON.stringify({
          sku: variant.sku,
          blank_id: product.blank_id,
          design_options: placement
            ? {
              scale: placement.scale,
              rotation: placement.rotation,
              align: "center",
            }
            : undefined,
        }),
      });
    }
    const shippingFee = DEFAULT_SHIPPING_FEE;
    let discount = 0;
    const couponCode = payload.couponCode || payload.coupon_code;
    let isPlatformCoupon = true;

    if (couponCode && typeof couponCode === 'string' && couponCode.trim()) {
      const applyResult = await PromotionService.validateAndApply(
        couponCode,
        subtotal,
        shippingFee,
        shopId || undefined,
        undefined,
        orderItems.map(it => ({
          productId: it.product_id.toString(),
          price: num(it.retail_price),
          quantity: it.quantity
        }))
      );

      if (!applyResult.valid) {
        throw new Error(applyResult.message || 'Mã giảm giá không hợp lệ.');
      }

      discount = applyResult.discount;
      isPlatformCoupon = applyResult.coupon?.is_platform ?? true;
    }

    const platformFee = subtotal * PLATFORM_FEE_RATE;
    // Nếu là Shop coupon, shop chịu trừ tiền. Nếu là Platform coupon, sàn bù tiền cho shop.
    const sellerPayoutAmount = isPlatformCoupon
      ? Math.max(0, subtotal - platformFee)
      : Math.max(0, subtotal - discount - platformFee);

    const gateway = String(
      payload.paymentGateway || payload.payment_method || "COD",
    ).toUpperCase();
    const paymentMethod = PAYMENT_METHODS.includes(gateway) ? gateway : "COD";

    if (hasPodItem && paymentMethod === "COD") {
      throw new Error(
        "Sản phẩm in theo yêu cầu (POD) phải thanh toán trước, không hỗ trợ COD. Vui lòng chọn VNPAY hoặc MOMO.",
      );
    }

    const carrierInput = String(
      payload.shippingProvider || "ghn",
    ).toLowerCase();
    const carrier = SHIPPING_CARRIERS.includes(carrierInput)
      ? carrierInput
      : "ghn";

    const now = new Date();
    const order = await OrderModel.create({
      buyer_id: buyerObjectId,
      shop_id: shopId,
      order_code: `VC-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`,
      payment_method: paymentMethod,
      payment_status: "PENDING",
      order_status: "ORDERED",
      shipping_address: {
        recipient_name: address.recipient_name,
        phone: address.phone,
        address_detail: address.address_detail,
        province_id: address.province_id || "79",
        district_id: address.district_id || "760",
        ward_code: address.ward_code || "26734",
      },
      shipping_details: {
        carrier,
        tracking_number: "",
        shipping_fee: dec(shippingFee),
      },
      items: orderItems,
      financial_breakdown: {
        subtotal: dec(subtotal),
        shipping_fee: dec(shippingFee),
        coupon_discount: dec(discount),
        platform_fee: dec(platformFee),
        seller_payout_amount: dec(sellerPayoutAmount),
      },
      status_history: [
        { status: "ORDERED", changed_at: now, note: "Đơn được tạo" },
      ],
      order_hour_of_week: now.getDay() * 24 + now.getHours(),
    });

    if (couponCode) {
      await PromotionService.recordUsage(couponCode).catch(err => {
        console.error('Lỗi khi ghi nhận lượt sử dụng coupon:', err);
      });
    }


    // Phát thông báo Realtime cho Người mua & Người bán
    try {
      // 1. Thông báo cho người mua
      await notificationService.createNotification({
        user_id: buyerId,
        type: 'ORDER_UPDATE',
        title: 'Đặt hàng thành công',
        content: `Đơn hàng #${order.order_code} đã được tạo thành công.`,
        link: `/orders/${order._id}`,
        metadata: { orderId: order._id.toString(), orderCode: order.order_code }
      });

      // 2. Thông báo cho người bán (nếu có shop)
      if (shopId) {
        const shop = await Shop.findById(shopId);
        if (shop?.owner_id) {
          await notificationService.createNotification({
            user_id: shop.owner_id.toString(),
            type: 'ORDER_UPDATE',
            title: 'Bạn có đơn hàng mới',
            content: `Đơn hàng mới #${order.order_code} với giá trị ${subtotal.toLocaleString('vi-VN')}₫ cần xử lý.`,
            link: `/seller/orders`,
            metadata: { orderId: order._id.toString(), orderCode: order.order_code }
          });
        }
      }
    } catch (err: any) {
      console.error('[NOTIFICATION] Lỗi tạo thông báo đơn hàng mới:', err?.message || err);
    }

    const populated = await OrderModel.findById(order._id)
      .populate("shop_id")
      .populate({ path: 'items.product_id', select: 'images title' });
    return mapDbOrderToResponse(populated || order);
  }

  static async getOrder(id: string, buyerId: string): Promise<OrderResponse> {
    const query: any = byCodeOrId(id);
    query.buyer_id = toBuyerObjectId(buyerId);

    const order = await OrderModel.findOne(query)
      .populate("shop_id")
      .populate({ path: 'items.product_id', select: 'images title' });
    if (!order) throw new Error("Không tìm thấy đơn hàng");

    const reviews = await Review.find({
      order_id: order._id,
      buyer_id: toBuyerObjectId(buyerId)
    }).lean();

    const reviewsMap = new Map<string, any>();
    for (const rev of reviews) {
      if (rev.order_id && rev.product_id) {
        reviewsMap.set(`${rev.order_id.toString()}_${rev.product_id.toString()}`, rev);
        if (order.order_code) {
          reviewsMap.set(`${order.order_code}_${rev.product_id.toString()}`, rev);
        }
      }
    }

    return mapDbOrderToResponse(order, reviewsMap);
  }

  static async getOrdersByBuyer(
    buyerId: string,
    status?: string,
  ): Promise<OrderResponse[]> {
    const query: any = { buyer_id: toBuyerObjectId(buyerId) };

    if (status && status.toLowerCase() !== "all") {
      switch (status.toLowerCase()) {
        case "pending":
          query.order_status = { $in: ["ORDERED", "PENDING_DESIGN"] };
          break;
        case "paid":
          query.order_status = "PROCESSING";
          break;
        case "shipping":
          query.order_status = "SHIPPING";
          break;
        case "completed":
          query.order_status = "DELIVERED";
          break;
        case "cancelled":
          query.order_status = "CANCELLED";
          break;
      }
    }

    const orders = await OrderModel.find(query)
      .populate("shop_id")
      .populate({ path: 'items.product_id', select: 'images title' })
      .sort({ created_at: -1 })
      .lean();

    const orderIds = orders.map(o => o._id);
    const reviews = await Review.find({
      order_id: { $in: orderIds },
      buyer_id: toBuyerObjectId(buyerId)
    }).lean();

    const reviewsMap = new Map<string, any>();
    const orderCodeMap = new Map<string, string>();
    for (const ord of orders) {
      if (ord._id && ord.order_code) {
        orderCodeMap.set(ord._id.toString(), ord.order_code);
      }
    }

    for (const rev of reviews) {
      if (rev.order_id && rev.product_id) {
        const oIdStr = rev.order_id.toString();
        const pIdStr = rev.product_id.toString();
        reviewsMap.set(`${oIdStr}_${pIdStr}`, rev);
        const code = orderCodeMap.get(oIdStr);
        if (code) {
          reviewsMap.set(`${code}_${pIdStr}`, rev);
        }
      }
    }

    return orders.map(ord => mapDbOrderToResponse(ord, reviewsMap));
  }

  /*
   * Cổng thanh toán callback 
   * 'success' → PAID + PROCESSING rồi đẩy đơn sang xưởng in; ngược lại → CANCELLED.
   */
  static async processPaymentCallback(
    id: string,
    gatewayStatus: string,
  ): Promise<OrderResponse> {
    const order = await OrderModel.findOne(byCodeOrId(id)).populate("shop_id");
    if (!order) throw new Error("Không tìm thấy đơn hàng");

    if (gatewayStatus === "success") {
      order.payment_status = "PAID";
      order.order_status = "PROCESSING";
      order.status_history.push({
        status: "PROCESSING",
        changed_at: new Date(),
        note: "Thanh toán thành công. Đơn hàng chuyển sang sản xuất.",
      });
      await order.save();
      dispatchToPrinter(order).catch((err: any) =>
        console.error(
          "[DISPATCH] lỗi gửi đơn sang Printer:",
          err?.message || err,
        ),
      );

      try {
        await notificationService.createNotification({
          user_id: order.buyer_id.toString(),
          type: 'ORDER_UPDATE',
          title: 'Thanh toán thành công',
          content: `Đơn hàng #${order.order_code} đã thanh toán thành công và chuyển sang xử lý sản xuất.`,
          link: `/orders/${order._id}`,
          metadata: { orderId: order._id.toString(), orderCode: order.order_code, status: 'PROCESSING' }
        });
      } catch (err: any) {
        console.error('[NOTIFICATION] Lỗi gửi thông báo thanh toán thành công:', err?.message || err);
      }
    } else {
      order.payment_status = "PENDING";
      order.order_status = "CANCELLED";
      order.status_history.push({
        status: "CANCELLED",
        changed_at: new Date(),
        note: "Thanh toán thất bại hoặc người dùng huỷ.",
      });
      await order.save();

      try {
        await notificationService.createNotification({
          user_id: order.buyer_id.toString(),
          type: 'ORDER_UPDATE',
          title: 'Đơn hàng đã bị huỷ',
          content: `Đơn hàng #${order.order_code} đã bị huỷ do thanh toán không thành công.`,
          link: `/orders/${order._id}`,
          metadata: { orderId: order._id.toString(), orderCode: order.order_code, status: 'CANCELLED' }
        });
      } catch (err: any) {
        console.error('[NOTIFICATION] Lỗi gửi thông báo huỷ đơn hàng:', err?.message || err);
      }
    }

    return mapDbOrderToResponse(order);
  }

  static async handlePrinterStatusWebhook(payload: {
    order_code?: string;
    vietcraft_order_id?: string;
    status: string;
  }): Promise<{ success: boolean; message: string }> {
    const query: any = {};
    if (payload.vietcraft_order_id && mongoose.Types.ObjectId.isValid(payload.vietcraft_order_id)) {
      query._id = new mongoose.Types.ObjectId(payload.vietcraft_order_id);
    } else if (payload.order_code) {
      query.order_code = payload.order_code;
    } else {
      throw new Error('Thiếu order_code hoặc vietcraft_order_id.');
    }

    const order = await OrderModel.findOne(query).populate('shop_id');
    if (!order) throw new Error('Không tìm thấy đơn hàng trên sàn VietCraft.');

    const pStatus = (payload.status || '').toUpperCase();
    let note = `Xưởng in cập nhật trạng thái: ${pStatus}`;
    let buyerTitle = `Tiến độ đơn hàng #${order.order_code}`;
    let buyerContent = '';

    if (pStatus === 'PRINTING') {
      if (['ORDERED', 'PENDING_DESIGN'].includes(order.order_status)) {
        order.order_status = 'PROCESSING';
      }
      note = 'Xưởng in đã tiếp nhận file thiết kế và đang tiến hành in ấn.';
      buyerContent = `Đơn hàng #${order.order_code} của bạn đang được xưởng in ấn và sản xuất.`;
    } else if (pStatus === 'PACKAGED') {
      note = 'Xưởng in đã hoàn tất in ấn và đang đóng gói sản phẩm.';
      buyerContent = `Đơn hàng #${order.order_code} của bạn đã in xong và đang được đóng gói chờ giao.`;
    } else if (pStatus === 'SHIPPED') {
      order.order_status = 'SHIPPING';
      note = 'Xưởng in đã hoàn tất đóng gói và xuất kho giao hàng.';
      buyerContent = `Đơn hàng #${order.order_code} của bạn đã được xuất kho và bàn giao cho đơn vị vận chuyển.`;
    }

    order.status_history.push({
      status: order.order_status,
      changed_at: new Date(),
      note
    });
    await order.save();

    if (buyerContent && order.buyer_id) {
      try {
        await notificationService.createNotification({
          user_id: order.buyer_id.toString(),
          type: 'ORDER_UPDATE',
          title: buyerTitle,
          content: buyerContent,
          link: `/orders/${order._id}`,
          metadata: { orderId: order._id.toString(), orderCode: order.order_code, printerStatus: pStatus }
        });
      } catch (err: any) {
        console.error('[PRINTER WEBHOOK] Lỗi gửi thông báo cho Buyer:', err?.message || err);
      }
    }

    const shopOwnerId = (order.shop_id as any)?.owner_id;
    if (shopOwnerId) {
      try {
        await notificationService.createNotification({
          user_id: shopOwnerId.toString(),
          type: 'ORDER_UPDATE',
          title: `Xưởng in: Đơn #${order.order_code}`,
          content: `Xưởng in vừa cập nhật tiến độ đơn #${order.order_code}: ${note}`,
          link: `/seller/orders`,
          metadata: { orderId: order._id.toString(), orderCode: order.order_code, printerStatus: pStatus }
        });
      } catch (err: any) {
        console.error('[PRINTER WEBHOOK] Lỗi gửi thông báo cho Seller:', err?.message || err);
      }
    }

    return { success: true, message: `Đã cập nhật trạng thái đơn ${order.order_code} sang ${pStatus}` };
  }

  static async handlePrinterTrackingWebhook(payload: {
    order_code?: string;
    vietcraft_order_id?: string;
    carrier?: string;
    tracking_number?: string;
  }): Promise<{ success: boolean; message: string }> {
    const query: any = {};
    if (payload.vietcraft_order_id && mongoose.Types.ObjectId.isValid(payload.vietcraft_order_id)) {
      query._id = new mongoose.Types.ObjectId(payload.vietcraft_order_id);
    } else if (payload.order_code) {
      query.order_code = payload.order_code;
    } else {
      throw new Error('Thiếu order_code hoặc vietcraft_order_id.');
    }

    const order = await OrderModel.findOne(query).populate('shop_id');
    if (!order) throw new Error('Không tìm thấy đơn hàng trên sàn VietCraft.');

    const carrier = (payload.carrier || 'GHN').toUpperCase();
    const tracking = payload.tracking_number || '';

    order.shipping_details = {
      ...(order.shipping_details || {}),
      carrier: carrier.toLowerCase(),
      tracking_number: tracking,
      shipping_fee: order.shipping_details?.shipping_fee || (mongoose.Types.Decimal128.fromString('0.0'))
    };

    order.order_status = 'SHIPPING';
    order.status_history.push({
      status: 'SHIPPING',
      changed_at: new Date(),
      note: `Xưởng in đã xuất kho qua hãng ${carrier}, mã vận đơn: ${tracking}`
    });
    await order.save();

    if (order.buyer_id) {
      try {
        await notificationService.createNotification({
          user_id: order.buyer_id.toString(),
          type: 'ORDER_UPDATE',
          title: `Đơn hàng #${order.order_code} đang được giao`,
          content: `Đơn hàng #${order.order_code} đã bàn giao cho ${carrier} với mã vận đơn ${tracking}.`,
          link: `/orders/${order._id}`,
          metadata: { orderId: order._id.toString(), orderCode: order.order_code, carrier, tracking }
        });
      } catch (err: any) {
        console.error('[TRACKING WEBHOOK] Lỗi gửi thông báo cho Buyer:', err?.message || err);
      }
    }

    const shopOwnerId = (order.shop_id as any)?.owner_id;
    if (shopOwnerId) {
      try {
        await notificationService.createNotification({
          user_id: shopOwnerId.toString(),
          type: 'ORDER_UPDATE',
          title: `Đơn #${order.order_code} đã xuất kho`,
          content: `Đơn hàng #${order.order_code} đã được xưởng in giao cho ${carrier}, mã vận đơn: ${tracking}.`,
          link: `/seller/orders`,
          metadata: { orderId: order._id.toString(), orderCode: order.order_code, carrier, tracking }
        });
      } catch (err: any) {
        console.error('[TRACKING WEBHOOK] Lỗi gửi thông báo cho Seller:', err?.message || err);
      }
    }

    return { success: true, message: `Đã cập nhật mã vận đơn ${tracking} (${carrier}) cho đơn ${order.order_code}` };
  }

  static async handleProviderWebhook(
    payload: {
      order_code?: string;
      vietcraft_order_id?: string;
      supplier_order_id?: string;
      status?: string;
      carrier?: string;
      tracking_number?: string;
      event?: string;
      note?: string;
    },
    headers: any = {},
    ip = ''
  ): Promise<{ success: boolean; message: string }> {
    const query: any = {};
    if (payload.vietcraft_order_id && mongoose.Types.ObjectId.isValid(payload.vietcraft_order_id)) {
      query._id = new mongoose.Types.ObjectId(payload.vietcraft_order_id);
    } else if (payload.order_code) {
      query.order_code = payload.order_code;
    } else if (payload.supplier_order_id) {
      query.supplier_order_id = payload.supplier_order_id;
    } else {
      throw new Error('Thiếu thông tin định danh đơn hàng (order_code, vietcraft_order_id hoặc supplier_order_id).');
    }

    const order = await OrderModel.findOne(query).populate('shop_id');
    if (!order) {
      throw new Error(`Không tìm thấy đơn hàng trên sàn VietCraft với điều kiện: ${JSON.stringify(query)}`);
    }

    const pStatus = (payload.status || '').toUpperCase();
    const carrier = payload.carrier ? payload.carrier.toUpperCase() : undefined;
    const tracking = payload.tracking_number || '';

    if (payload.supplier_order_id && !order.supplier_order_id) {
      order.supplier_order_id = payload.supplier_order_id;
    }

    let statusNote = payload.note || `Xưởng in cập nhật trạng thái: ${pStatus}`;
    let buyerTitle = `Cập nhật đơn hàng #${order.order_code}`;
    let buyerContent = '';

    if (pStatus === 'RECEIVED') {
      order.fulfillment_status = 'RECEIVED';
      statusNote = 'Xưởng in đã tiếp nhận đơn hàng vào quy trình sản xuất.';
      buyerContent = `Đơn hàng #${order.order_code} đã được chuyển tới xưởng in và chuẩn bị phôi.`;
    } else if (pStatus === 'PRINTING') {
      order.fulfillment_status = 'PRINTING';
      if (['ORDERED', 'PENDING_DESIGN'].includes(order.order_status)) {
        order.order_status = 'PROCESSING';
      }
      statusNote = 'Xưởng in đang tiến hành in ấn sản phẩm.';
      buyerContent = `Đơn hàng #${order.order_code} của bạn đang được xưởng in ấn theo bản vẽ.`;
    } else if (pStatus === 'PACKAGED') {
      order.fulfillment_status = 'PACKAGED';
      statusNote = 'Xưởng in đã hoàn tất in ấn và đang đóng gói.';
      buyerContent = `Đơn hàng #${order.order_code} đã in xong và đang được đóng gói chờ xuất kho.`;
    } else if (pStatus === 'SHIPPED') {
      order.fulfillment_status = 'SHIPPED';
      order.order_status = 'SHIPPING';
      statusNote = `Xưởng in đã xuất kho và giao cho hãng vận chuyển${carrier ? ` ${carrier}` : ''}${tracking ? ` (Mã: ${tracking})` : ''}.`;
      buyerContent = `Đơn hàng #${order.order_code} đã xuất kho và đang được giao đến bạn.`;
    } else if (pStatus === 'CANCELLED') {
      order.fulfillment_status = 'CANCELLED';
      statusNote = 'Xưởng in đã hủy sản xuất đơn hàng.';
    }

    if (tracking) {
      order.shipping_details = {
        ...(order.shipping_details || {}),
        carrier: (carrier || order.shipping_details?.carrier || 'GHN').toLowerCase(),
        tracking_number: tracking,
        shipping_fee: order.shipping_details?.shipping_fee || (mongoose.Types.Decimal128.fromString('0.0'))
      };
      order.order_status = 'SHIPPING';
      order.fulfillment_status = 'SHIPPED';
    }

    order.status_history.push({
      status: order.order_status,
      changed_at: new Date(),
      note: statusNote
    });

    await order.save();

    await WebhookLog.create({
      provider: 'PRINTING_SHOP',
      event_type: payload.event || pStatus || (tracking ? 'TRACKING_UPDATE' : 'STATUS_UPDATE'),
      order_id: order._id,
      order_code: order.order_code,
      supplier_order_id: order.supplier_order_id,
      payload,
      headers,
      signature_valid: true,
      status: 'SUCCESS',
      ip_address: ip,
      processed_at: new Date()
    }).catch(err => console.error('[WEBHOOK LOG ERROR]', err));

    if (buyerContent && order.buyer_id) {
      try {
        await notificationService.createNotification({
          user_id: order.buyer_id.toString(),
          type: 'ORDER_UPDATE',
          title: buyerTitle,
          content: buyerContent,
          link: `/orders/${order._id}`,
          metadata: { orderId: order._id.toString(), orderCode: order.order_code, fulfillmentStatus: order.fulfillment_status, tracking }
        });
      } catch (err: any) {
        console.error('[WEBHOOK NOTIFY] Lỗi gửi thông báo cho Buyer:', err?.message || err);
      }
    }

    const shopOwnerId = (order.shop_id as any)?.owner_id;
    if (shopOwnerId) {
      try {
        await notificationService.createNotification({
          user_id: shopOwnerId.toString(),
          type: 'ORDER_UPDATE',
          title: `Xưởng in: Đơn #${order.order_code}`,
          content: `Xưởng in vừa cập nhật tiến độ đơn #${order.order_code}: ${statusNote}`,
          link: `/seller/orders`,
          metadata: { orderId: order._id.toString(), orderCode: order.order_code, fulfillmentStatus: order.fulfillment_status, tracking }
        });
      } catch (err: any) {
        console.error('[WEBHOOK NOTIFY] Lỗi gửi thông báo cho Seller:', err?.message || err);
      }
    }

    return {
      success: true,
      message: `Đã cập nhật trạng thái đơn ${order.order_code} thành ${order.fulfillment_status || order.order_status}`
    };
  }
}
export default OrdersService;
