import mongoose from "mongoose";
import { Order as OrderModel } from "../infrastructure/models/order.model";
import { Product } from "../../product/infrastructure/models/product.model";
import { ProductVariant } from "../../product/infrastructure/models/product-variant.model";
import { Design } from "../../design/infrastructure/models/design.model";
import { dispatchToPrinter } from "./printer-dispatch.service";
import { OrderResponse, DEFAULT_SHIPPING_FEE, PLATFORM_FEE_RATE, PAYMENT_METHODS, SHIPPING_CARRIERS,  } from "../types";
import { mapDbOrderToResponse} from "../infrastructure/dto/order.dto";
import { byCodeOrId, dec, num, toBuyerObjectId } from "../utils";

export class OrdersService {
  /**
   * Tạo order từ payload FE: [{ productId, variantId, quantity }].
   * Giá, shop, thông tin POD đều đọc từ DB; `price`/`totalAmount`/`discount` do client gửi bị bỏ qua.
   */
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
    // Đơn có hàng in theo yêu cầu hay không — quyết định phương thức thanh toán hợp lệ.
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

      // Biến thể: theo variantId nếu client gửi, không thì lấy biến thể đang bán đầu tiên
      // (giỏ hàng cho phép item không có variant_id).
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

      // 1 order = 1 shop: shop lấy từ product trong DB, không lấy theo shop_name client gửi.
      if (shopId && shopId.toString() !== product.shop_id.toString()) {
        throw new Error(
          "Đơn hàng chỉ hỗ trợ 1 shop mỗi lần (MVP). Vui lòng tách đơn theo shop.",
        );
      }
      shopId = product.shop_id;
      if (product.product_type === "POD_TEMPLATE") hasPodItem = true;

      // Giá LẤY TỪ DB — không bao giờ dùng it.price của client.
      subtotal += num(variant.retail_price) * qty;

      // POD: gắn design + options để Printer in. Lấy từ design_placement đầu tiên.
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
        image: variant.mockup_image || product.images?.[0],
        design_file_url: designUrl,
        // giữ tạm meta phôi + placement để dispatch (không đổi schema).
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
    const discount = 0; // TODO: validate coupon qua promotion module rồi mới trừ.
    const platformFee = subtotal * PLATFORM_FEE_RATE;
    const gateway = String(
      payload.paymentGateway || payload.payment_method || "COD",
    ).toUpperCase();
    const paymentMethod = PAYMENT_METHODS.includes(gateway) ? gateway : "COD";

    // Hàng POD chỉ được sản xuất sau khi tiền đã về: xưởng in cắt/in xong là không bán
    // lại được cho ai khác, nên rủi ro khách từ chối nhận rơi hết vào seller.
    // Chốt chặn phải nằm ở đây vì dispatchToPrinter chỉ chạy từ callback thanh toán —
    // một đơn POD trả COD sẽ nằm PENDING vĩnh viễn và không bao giờ tới xưởng in.
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
      // Mọi đơn đều bắt đầu PENDING; chỉ callback của cổng thanh toán mới được set PAID.
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
        seller_payout_amount: dec(subtotal - platformFee),
      },
      status_history: [
        { status: "ORDERED", changed_at: now, note: "Đơn được tạo" },
      ],
      order_hour_of_week: now.getDay() * 24 + now.getHours(),
    });

    const populated = await OrderModel.findById(order._id).populate("shop_id");
    return mapDbOrderToResponse(populated || order);
  }

  /** Nhận cả order_code lẫn _id, nhưng luôn giới hạn trong đơn của chính buyer. */
  static async getOrder(id: string, buyerId: string): Promise<OrderResponse> {
    const query: any = byCodeOrId(id);
    query.buyer_id = toBuyerObjectId(buyerId);

    const order = await OrderModel.findOne(query).populate("shop_id");
    if (!order) throw new Error("Không tìm thấy đơn hàng");
    return mapDbOrderToResponse(order);
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
      .sort({ created_at: -1 });
    return orders.map(mapDbOrderToResponse);
  }

  /**
   * Cổng thanh toán callback (nhận order_code hoặc _id):
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
      // Đẩy sang xưởng in (không chặn phản hồi thanh toán nếu Printer lỗi).
      dispatchToPrinter(order).catch((err: any) =>
        console.error(
          "[DISPATCH] lỗi gửi đơn sang Printer:",
          err?.message || err,
        ),
      );
    } else {
      order.payment_status = "PENDING";
      order.order_status = "CANCELLED";
      order.status_history.push({
        status: "CANCELLED",
        changed_at: new Date(),
        note: "Thanh toán thất bại. Đơn hàng tự động hủy.",
      });
      await order.save();
    }

    return mapDbOrderToResponse(order);
  }
}
export default OrdersService;
