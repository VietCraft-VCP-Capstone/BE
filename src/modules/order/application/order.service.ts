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
import { OrderResponse, DEFAULT_SHIPPING_FEE, PAYMENT_METHODS, SHIPPING_CARRIERS, } from "../types";
import { platformFinanceService } from "../../admin/application/platform-finance.service";
import { CommissionSetting } from "../../../shared/services/commission-setting.service";
import { commissionFromGross } from "../../../shared/utils/commission";
import { mapDbOrderToResponse } from "../infrastructure/dto/order.dto";
import { byCodeOrId, dec, num, toBuyerObjectId } from "../utils";
import { executeRefund } from "../../payment/application/refund-runtime";
import { payosService } from "../../payment/application/payos.service";
import { logger } from "../../../shared/utils/logger";


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
    let platformFee = 0;
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

      const lineTotal = num(variant.retail_price) * qty;
      subtotal += lineTotal;
      platformFee += commissionFromGross(
        lineTotal,
        await CommissionSetting.resolvePercent(
          product.category_ids?.[0] ? String(product.category_ids[0]) : null,
          product.product_type,
        ),
      );

      const placement = product.design_placements?.[0];
      let designUrl: string | undefined;
      if (placement?.design_id) {
        const design = await Design.findById(placement.design_id).lean();
        designUrl = design?.file_url;
      }

      orderItems.push({
        order_item_id: crypto.randomUUID(),
        item_snapshot: { product_id: String(product._id), variant_id: String(variant._id), title: product.title, color: variant.color, size: variant.size, image: product.images?.[0] || variant.mockup_image },
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
    let cleanCouponCode: string | undefined;

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
      cleanCouponCode = couponCode.trim().toUpperCase();

      await PromotionService.claimUsage(cleanCouponCode, buyerId);
    }

    let commissionRate = 0.10;
    let minOrderFee = 10000;
    try {
      const financeConfig = await platformFinanceService.getConfig();
      if (financeConfig?.policies) {
        commissionRate = financeConfig.policies.default_commission_rate ?? 0.10;
        minOrderFee = financeConfig.policies.min_order_fee ?? 10000;
      }
    } catch {
    }

    platformFee = Math.max(platformFee, minOrderFee);

    const totalPrintingCost = orderItems.reduce((acc, it) => acc + (num(it.base_cost) * it.quantity), 0);

    const sellerPayoutAmount = isPlatformCoupon
      ? Math.max(0, subtotal - platformFee)
      : Math.max(0, subtotal - discount - platformFee);

    const gateway = String(
      payload.paymentGateway || payload.payment_method || "COD",
    ).toUpperCase();
    const paymentMethod = PAYMENT_METHODS.includes(gateway) ? gateway : "COD";

    if (hasPodItem && paymentMethod === "COD") {
      // Hoàn lại lượt dùng voucher nếu đơn bị reject ở bước này
      if (cleanCouponCode) {
        await PromotionService.releaseUsage(cleanCouponCode).catch(() => { });
      }
      throw new Error(
        "Sản phẩm in theo yêu cầu (POD) phải thanh toán trước, không hỗ trợ COD. Vui lòng chọn VNPAY hoặc PAYOS.",
      );
    }

    const carrierInput = String(
      payload.shippingProvider || "ghn",
    ).toLowerCase();
    const carrier = SHIPPING_CARRIERS.includes(carrierInput)
      ? carrierInput
      : "ghn";

    const now = new Date();
    const isPodOrder = Boolean(hasPodItem);
    const order = await OrderModel.create({
      buyer_id: buyerObjectId,
      shop_id: shopId,
      order_code: `VC-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`,
      payment_method: paymentMethod,
      payment_status: "PENDING",
      order_status: "ORDERED",
      is_pod: isPodOrder,
      order_type: isPodOrder ? "POD" : "READY_TO_SHIP",
      seller_approval_status: "PENDING_APPROVAL",
      fulfillment_status: isPodOrder ? "PENDING_APPROVAL" : "UNFULFILLED",
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
        commission_rate: commissionRate,
        total_printing_cost: dec(totalPrintingCost),
      },
      coupon_code: cleanCouponCode || null,
      status_history: [
        { status: "ORDERED", changed_at: now, note: "Đơn được tạo" },
      ],
      order_hour_of_week: now.getDay() * 24 + now.getHours(),
    });

    // Trừ tồn kho biến thể tương ứng
    for (const it of orderItems) {
      if (it.variant_id) {
        await ProductVariant.updateOne(
          { _id: it.variant_id },
          { $inc: { stock_quantity: -it.quantity } }
        ).catch(err => console.error('[STOCK] Lỗi trừ tồn kho khi tạo đơn:', err?.message || err));
      }
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

      // 2. Thông báo cho người bán. Đơn trả trước chỉ báo khi tiền đã về (webhook/đối soát
      // của cổng thanh toán tự báo), tránh người bán thấy đơn mà không duyệt được.
      if (shopId && paymentMethod === 'COD') {
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

  /** Hoàn lại tồn kho và voucher khi đơn hàng bị hủy */
  static async restoreOrderStockAndCoupon(order: any): Promise<void> {
    if (order.coupon_code) {
      await PromotionService.releaseUsage(order.coupon_code).catch(err =>
        console.error('[COUPON] Lỗi hoàn lượt dùng voucher:', err?.message || err)
      );
    }
    if (Array.isArray(order.items)) {
      for (const it of order.items) {
        const vId = it.variant_id?._id || it.variant_id;
        if (vId) {
          await ProductVariant.updateOne(
            { _id: vId },
            { $inc: { stock_quantity: it.quantity || 1 } }
          ).catch(err => console.error('[STOCK] Lỗi hoàn tồn kho:', err?.message || err));
        }
      }
    }
  }

  /** Người mua tự hủy đơn hàng */
  static async cancelOrderByBuyer(orderId: string, buyerId: string, reason?: string): Promise<OrderResponse> {
    const query: any = byCodeOrId(orderId);
    query.buyer_id = toBuyerObjectId(buyerId);
    const order = await OrderModel.findOne(query);

    if (!order) {
      throw new Error('Không tìm thấy đơn hàng hoặc bạn không có quyền hủy đơn này');
    }

    if (order.order_status === 'CANCELLED') {
      throw new Error('Đơn hàng này đã được hủy trước đó');
    }
    if (order.order_status === 'DELIVERED' || order.fulfillment_status === 'SHIPPED' || order.fulfillment_status === 'DELIVERED') {
      throw new Error('Đơn hàng đã được bàn giao cho bên vận chuyển, không thể hủy');
    }

    // Đơn POD: nếu xưởng in đã tiếp nhận in hoặc đang in thì không thể tự hủy
    if (order.is_pod && ['SUBMITTED', 'RECEIVED', 'PRINTING', 'PACKAGED'].includes(order.fulfillment_status || '')) {
      throw new Error('Đơn hàng POD đã được gửi sang xưởng in và đang sản xuất, không thể hủy');
    }

    // Đơn hàng có sẵn: nếu người bán đã bấm chuẩn bị hàng (PROCESSING) hoặc duyệt đơn
    if (!order.is_pod && order.seller_approval_status === 'APPROVED' && order.order_status !== 'ORDERED') {
      throw new Error('Người bán đã chuẩn bị hàng, không thể tự hủy');
    }

    // Nếu đơn chọn PayOS nhưng DB đang PENDING: kiểm tra trực tiếp với cổng PayOS xem đã trả chưa
    if (order.payment_method === 'PAYOS' && order.payment_status === 'PENDING') {
      try {
        await payosService.syncPayment({ orderId: String(order._id) });
        const fresh = await OrderModel.findById(order._id);
        if (fresh) {
          order.payment_status = fresh.payment_status;
          order.paid_at = fresh.paid_at;
          order.payos_order_codes = fresh.payos_order_codes;
        }
      } catch (syncErr: any) {
        logger.warn(`[PayOS Sync on Cancel] #${order.order_code}: ${syncErr?.message || syncErr}`);
      }
    }

    // Nếu đơn PayOS đã PAID: đảm bảo giao dịch gốc đã ghi vào DB để có đủ thông tin ngân hàng hoàn tiền
    if (order.payment_method === 'PAYOS' && order.payment_status === 'PAID') {
      try {
        await payosService.ensurePaymentTransaction(String(order._id));
      } catch (ensureErr: any) {
        logger.warn(`[PayOS Ensure Tx on Cancel] #${order.order_code}: ${ensureErr?.message || ensureErr}`);
      }
    }

    const wasPaid = order.payment_status === 'PAID';
    const now = new Date();

    order.order_status = 'CANCELLED';
    order.fulfillment_status = 'CANCELLED';
    order.seller_approval_status = 'REJECTED';
    order.status_history.push({
      status: 'CANCELLED',
      changed_at: now,
      note: `Người mua tự hủy đơn hàng. Lý do: ${reason || 'Người mua đổi ý'}`
    });

    if (wasPaid) {
      order.refund_status = 'REQUESTED';
    }

    // Chỉ validate các trường vừa thay đổi: đơn cũ có thể thiếu trường bắt buộc (ward_code, base_cost...) khiến save() báo 400
    await order.save({ validateModifiedOnly: true });

    // Hoàn lại kho và voucher
    await OrdersService.restoreOrderStockAndCoupon(order);

    // Tự động kích hoạt lệnh hoàn tiền qua PayOS Payout / VNPay Refund
    let refundMessageSuffix = '';
    if (wasPaid && ['PAYOS', 'VNPAY'].includes(order.payment_method)) {
      const refundAmount = Math.max(0,
        num(order.financial_breakdown?.subtotal) +
        num(order.financial_breakdown?.shipping_fee) -
        num(order.financial_breakdown?.coupon_discount)
      );

      if (refundAmount > 0) {
        try {
          const refundResult = await executeRefund({
            orderId: String(order._id),
            businessKey: `CANCEL-${order.order_code}-${Date.now()}`,
            amount: Math.round(refundAmount),
            reason: `Người mua tự hủy đơn #${order.order_code}`,
            createdBy: String(buyerId),
          });

          if (refundResult.status === 'REFUNDED') {
            order.payment_status = 'REFUNDED';
            order.refund_status = 'REFUNDED';
            order.status_history.push({
              status: 'CANCELLED',
              changed_at: new Date(),
              note: `Cổng thanh toán đã hoàn trả thành công ${refundAmount.toLocaleString('vi-VN')}đ về tài khoản ngân hàng.`
            });
            await order.save({ validateModifiedOnly: true });
            refundMessageSuffix = ' Số tiền thanh toán đã được hoàn về tài khoản ngân hàng của bạn.';
            logger.info(`[AUTO-REFUND SUCCESS] #${order.order_code}: amount=${refundResult.amount}`);
          } else if (refundResult.status === 'PENDING') {
            order.refund_status = 'UNDER_REVIEW';
            order.status_history.push({
              status: 'CANCELLED',
              changed_at: new Date(),
              note: `Lệnh hoàn tiền ${refundAmount.toLocaleString('vi-VN')}đ đang được cổng thanh toán xử lý.`
            });
            await order.save({ validateModifiedOnly: true });
            refundMessageSuffix = ' Lệnh hoàn tiền đang được xử lý về tài khoản ngân hàng của bạn.';
            logger.info(`[AUTO-REFUND PENDING] #${order.order_code}: ${refundResult.error || 'Đang xử lý'}`);
          } else {
            const failReason = refundResult.error || 'Cổng thanh toán từ chối lệnh chi tiền';
            order.refund_status = 'REFUND_REJECTED';
            order.status_history.push({
              status: 'CANCELLED',
              changed_at: new Date(),
              note: `Hoàn tiền tự động không thành công: ${failReason}. Đang chờ đối soát hoàn thủ công.`
            });
            await order.save({ validateModifiedOnly: true });
            refundMessageSuffix = ` Lưu ý: Lệnh hoàn tiền tự động chưa hoàn tất (${failReason}). Hệ thống/Shop sẽ đối soát và hoàn tiền cho bạn.`;
            logger.error(`[AUTO-REFUND FAILED] #${order.order_code}: ${failReason}`);
          }
        } catch (refundErr: any) {
          const errMsg = refundErr?.message || String(refundErr);
          order.refund_status = 'REFUND_REJECTED';
          order.status_history.push({
            status: 'CANCELLED',
            changed_at: new Date(),
            note: `Lỗi xử lý hoàn tiền: ${errMsg}. Đang chờ đối soát hoàn thủ công.`
          });
          await order.save({ validateModifiedOnly: true });
          refundMessageSuffix = ` Lưu ý: Lỗi xử lý hoàn tiền (${errMsg}). Hệ thống/Shop sẽ đối soát và hoàn tiền cho bạn.`;
          logger.error(`[AUTO-REFUND ERROR] #${order.order_code}: ${errMsg}`);
        }
      }
    }

    // Thông báo cho Buyer
    try {
      await notificationService.createNotification({
        user_id: buyerId,
        type: 'ORDER_UPDATE',
        title: 'Hủy đơn hàng thành công',
        content: `Đơn hàng #${order.order_code} đã được hủy thành công.${refundMessageSuffix}`,
        link: `/orders/${order._id}`,
        metadata: { orderId: order._id.toString(), orderCode: order.order_code, status: 'CANCELLED' }
      });
    } catch (err: any) {
      console.error('[NOTIFICATION] Lỗi gửi thông báo hủy đơn cho Buyer:', err?.message || err);
    }

    // Thông báo cho Seller
    try {
      if (order.shop_id) {
        const shop = await Shop.findById(order.shop_id);
        if (shop?.owner_id) {
          await notificationService.createNotification({
            user_id: shop.owner_id.toString(),
            type: 'ORDER_UPDATE',
            title: 'Khách hàng đã hủy đơn',
            content: `Đơn hàng #${order.order_code} đã bị người mua hủy. Lý do: ${reason || 'Người mua đổi ý'}`,
            link: `/seller/orders`,
            metadata: { orderId: order._id.toString(), orderCode: order.order_code, status: 'CANCELLED' }
          });
        }
      }
    } catch (err: any) {
      console.error('[NOTIFICATION] Lỗi gửi thông báo hủy đơn cho Seller:', err?.message || err);
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
      order.paid_at = order.paid_at || new Date();
      const shop = order.shop_id as any;
      const isPod = Boolean(order.is_pod || order.order_type === 'POD' || order.items?.some((it: any) => it.design_file_url));

      if (isPod) {
        order.is_pod = true;
        order.order_type = 'POD';
        const isAutoApprove = Boolean(shop?.printer_partner?.auto_approve);

        if (isAutoApprove) {
          order.order_status = "PROCESSING";
          order.seller_approval_status = "APPROVED";
          order.status_history.push({
            status: "PROCESSING",
            changed_at: new Date(),
            note: "Thanh toán thành công. Đơn hàng POD được tự động duyệt và chuyển xưởng in.",
          });
          await order.save();
          dispatchToPrinter(order).catch((err: any) =>
            console.error("[DISPATCH] lỗi gửi đơn sang Printer:", err?.message || err),
          );
        } else {
          order.seller_approval_status = "PENDING_APPROVAL";
          order.fulfillment_status = "PENDING_APPROVAL";
          order.status_history.push({
            status: order.order_status,
            changed_at: new Date(),
            note: "Thanh toán thành công. Đơn hàng POD đang chờ người bán kiểm tra thiết kế và duyệt đơn.",
          });
          await order.save();
        }

        try {
          await notificationService.createNotification({
            user_id: order.buyer_id.toString(),
            type: 'ORDER_UPDATE',
            title: 'Thanh toán thành công',
            content: isAutoApprove
              ? `Đơn hàng POD #${order.order_code} đã thanh toán thành công và chuyển sang xưởng sản xuất.`
              : `Đơn hàng POD #${order.order_code} đã thanh toán thành công và đang chờ người bán kiểm tra thiết kế trước khi in.`,
            link: `/orders/${order._id}`,
            metadata: { orderId: order._id.toString(), orderCode: order.order_code, status: order.order_status, isPod: true }
          });
        } catch (err: any) {
          console.error('[NOTIFICATION] Lỗi gửi thông báo thanh toán thành công cho Buyer:', err?.message || err);
        }

        if (shop?.owner_id) {
          try {
            await notificationService.createNotification({
              user_id: shop.owner_id.toString(),
              type: 'ORDER_UPDATE',
              title: isAutoApprove ? 'Đơn hàng POD đã chuyển xưởng in' : 'Đơn hàng POD mới cần duyệt in',
              content: isAutoApprove
                ? `Đơn hàng POD #${order.order_code} đã được tự động chuyển sang xưởng in.`
                : `Đơn hàng POD #${order.order_code} đã thanh toán và đang chờ bạn kiểm tra thiết kế, duyệt gửi sang xưởng in.`,
              link: `/seller/orders`,
              metadata: { orderId: order._id.toString(), orderCode: order.order_code, status: order.seller_approval_status, isPod: true }
            });
          } catch (err: any) {
            console.error('[NOTIFICATION] Lỗi gửi thông báo cho Seller:', err?.message || err);
          }
        }
      } else {
        // Hàng có sẵn của người bán: không gửi xưởng in, seller là người duyệt đơn và trực tiếp cập nhật trạng thái
        order.is_pod = false;
        order.order_type = 'READY_TO_SHIP';
        order.order_status = "ORDERED";
        order.seller_approval_status = "PENDING_APPROVAL";
        order.fulfillment_status = "UNFULFILLED";
        order.status_history.push({
          status: "ORDERED",
          changed_at: new Date(),
          note: "Thanh toán thành công. Đơn hàng có sẵn đang chờ người bán duyệt đơn và chuẩn bị hàng.",
        });
        await order.save();

        try {
          await notificationService.createNotification({
            user_id: order.buyer_id.toString(),
            type: 'ORDER_UPDATE',
            title: 'Thanh toán thành công',
            content: `Đơn hàng #${order.order_code} đã thanh toán thành công và đang chờ người bán duyệt đơn chuẩn bị hàng.`,
            link: `/orders/${order._id}`,
            metadata: { orderId: order._id.toString(), orderCode: order.order_code, status: order.order_status, isPod: false }
          });
        } catch (err: any) {
          console.error('[NOTIFICATION] Lỗi gửi thông báo thanh toán thành công cho Buyer:', err?.message || err);
        }

        if (shop?.owner_id) {
          try {
            await notificationService.createNotification({
              user_id: shop.owner_id.toString(),
              type: 'ORDER_UPDATE',
              title: 'Đơn hàng mới cần duyệt',
              content: `Đơn hàng #${order.order_code} đã được thanh toán. Hãy kiểm tra kho và duyệt đơn để chuẩn bị hàng.`,
              link: `/seller/orders`,
              metadata: { orderId: order._id.toString(), orderCode: order.order_code, status: 'PENDING_APPROVAL', isPod: false }
            });
          } catch (err: any) {
            console.error('[NOTIFICATION] Lỗi gửi thông báo cho Seller:', err?.message || err);
          }
        }
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

      // Hoàn lại lượt dùng voucher và tồn kho khi đơn bị huỷ
      await OrdersService.restoreOrderStockAndCoupon(order);

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

    order.is_pod = true;
    order.order_type = 'POD';

    if (!order.printer_info) order.printer_info = {};
    order.printer_info.printer_status = pStatus;

    if (pStatus === 'RECEIVED') {
      order.fulfillment_status = 'RECEIVED';
      note = 'Xưởng in đã tiếp nhận file thiết kế và chuẩn bị in ấn.';
      buyerContent = `Đơn hàng #${order.order_code} của bạn đã được xưởng in tiếp nhận.`;
    } else if (pStatus === 'PRINTING') {
      order.fulfillment_status = 'PRINTING';
      if (['ORDERED', 'PENDING_DESIGN'].includes(order.order_status)) {
        order.order_status = 'PROCESSING';
      }
      note = 'Xưởng in đã tiếp nhận file thiết kế và đang tiến hành in ấn.';
      buyerContent = `Đơn hàng #${order.order_code} của bạn đang được xưởng in ấn và sản xuất.`;
    } else if (pStatus === 'PACKAGED') {
      order.fulfillment_status = 'PACKAGED';
      if (['ORDERED', 'PENDING_DESIGN'].includes(order.order_status)) {
        order.order_status = 'PROCESSING';
      }
      note = 'Xưởng in đã hoàn tất in ấn và đang đóng gói sản phẩm.';
      buyerContent = `Đơn hàng #${order.order_code} của bạn đã in xong và đang được đóng gói chờ giao.`;
    } else if (pStatus === 'SHIPPED') {
      order.fulfillment_status = 'SHIPPED';
      order.order_status = 'SHIPPING';
      note = 'Xưởng in đã hoàn tất đóng gói và xuất kho giao hàng.';
      buyerContent = `Đơn hàng #${order.order_code} của bạn đã được xuất kho và bàn giao cho đơn vị vận chuyển.`;
    } else if (pStatus === 'REJECTED') {
      order.fulfillment_status = 'FAILED';
      const reason = (payload as any).rejection_reason || 'File in không đạt chuẩn hoặc lỗi kỹ thuật từ xưởng';
      order.printer_info.rejection_reason = reason;
      note = `Xưởng in từ chối đơn in: ${reason}`;
      buyerTitle = `Thông báo sự cố đơn #${order.order_code}`;
      buyerContent = `Đơn hàng #${order.order_code} gặp sự cố in ấn: ${reason}. Người bán sẽ kiểm tra và hỗ trợ bạn.`;
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

    order.is_pod = true;
    order.order_type = 'POD';
    order.order_status = 'SHIPPING';
    order.fulfillment_status = 'SHIPPED';
    if (!order.printer_info) order.printer_info = {};
    order.printer_info.printer_status = 'SHIPPED';
    order.printer_info.supplier_order_id = payload.vietcraft_order_id || order.supplier_order_id;
    order.shipping_details.carrier = carrier;
    order.shipping_details.tracking_number = tracking;

    order.shipping_details = {
      ...(order.shipping_details || {}),
      carrier: carrier.toLowerCase(),
      tracking_number: tracking,
      shipping_fee: order.shipping_details?.shipping_fee || (mongoose.Types.Decimal128.fromString('0.0'))
    };

    order.order_status = 'SHIPPING';
    order.markModified('printer_info');
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
    } else if (pStatus === 'DELIVERED') {
      order.fulfillment_status = 'DELIVERED';
      order.order_status = 'DELIVERED';
      if (order.payment_method === 'COD' && order.payment_status === 'PENDING') {
        order.payment_status = 'PAID';
      }
      statusNote = 'Đơn vị vận chuyển đã giao hàng thành công đến người nhận.';
      buyerContent = `Đơn hàng #${order.order_code} đã được giao thành công đến bạn.`;
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
      if (order.order_status !== 'DELIVERED') {
        order.order_status = 'SHIPPING';
        order.fulfillment_status = 'SHIPPED';
      }
    }

    order.is_pod = true;
    order.order_type = 'POD';
    if (!order.printer_info) {
      order.printer_info = {
        printer_id: 'PRINTER_SHOP',
        printer_name: 'Xưởng In VietCraft',
        supplier_order_id: payload.supplier_order_id || order.supplier_order_id,
        printer_status: pStatus,
        dispatched_at: new Date()
      };
    } else {
      order.printer_info.printer_status = pStatus;
      if (payload.supplier_order_id) order.printer_info.supplier_order_id = payload.supplier_order_id;
    }
    order.markModified('printer_info');

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

  /**
   * Người mua xác nhận đã nhận được hàng (DELIVERED)
   */
  static async confirmDeliveryByBuyer(orderIdOrCode: string, buyerId: string) {
    const query: any = {
      buyer_id: new mongoose.Types.ObjectId(buyerId),
      $or: [
        { order_code: orderIdOrCode },
        { _id: mongoose.Types.ObjectId.isValid(orderIdOrCode) ? new mongoose.Types.ObjectId(orderIdOrCode) : null }
      ]
    };

    const order = await OrderModel.findOne(query).populate('shop_id');
    if (!order) {
      throw new Error('Không tìm thấy đơn hàng của bạn.');
    }

    if (order.order_status === 'DELIVERED') {
      return { success: true, message: 'Đơn hàng đã được xác nhận giao thành công trước đó.', order };
    }

    if (order.order_status !== 'SHIPPING') {
      throw new Error('Chỉ có thể xác nhận đã nhận hàng khi đơn hàng đang trong trạng thái Đang giao.');
    }

    order.order_status = 'DELIVERED';
    order.fulfillment_status = 'DELIVERED';
    if (!order.printer_info) order.printer_info = {};
    order.printer_info.printer_status = 'DELIVERED';
    order.markModified('printer_info');

    if (order.payment_method === 'COD' && order.payment_status === 'PENDING') {
      order.payment_status = 'PAID';
    }

    order.status_history.push({
      status: 'DELIVERED',
      changed_at: new Date(),
      note: 'Khách hàng đã bấm xác nhận nhận được hàng thành công.'
    });
    await order.save();

    // Thông báo realtime cho Người bán
    const shopOwnerId = (order.shop_id as any)?.owner_id;
    if (shopOwnerId) {
      try {
        await notificationService.createNotification({
          user_id: shopOwnerId.toString(),
          type: 'ORDER_UPDATE',
          title: `Đơn hàng #${order.order_code} đã giao thành công`,
          content: `Khách hàng đã bấm xác nhận nhận được đơn hàng #${order.order_code}. Doanh thu đã được cộng vào tài khoản của bạn.`,
          link: `/seller/orders`,
          metadata: { orderId: order._id.toString(), orderCode: order.order_code, status: 'DELIVERED' }
        });
      } catch (err: any) {
        console.error('[CONFIRM DELIVERY NOTIFY] Lỗi gửi thông báo cho Seller:', err?.message || err);
      }
    }

    return { success: true, message: 'Đã xác nhận nhận hàng thành công.', order };
  }
}
export default OrdersService;
