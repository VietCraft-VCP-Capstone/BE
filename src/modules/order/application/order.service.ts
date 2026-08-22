import mongoose from 'mongoose';
import { Order } from '../infrastructure/models/order.model';
import { Product } from '../../product/infrastructure/models/product.model';
import { ProductVariant } from '../../product/infrastructure/models/product-variant.model';
import { Design } from '../../design/infrastructure/models/design.model';
import { dispatchToPrinter } from './printer-dispatch.service';

// ponytail: order persist thật trên Mongo (Order model sẵn có). Thay hẳn mock in-memory cũ.
// Giữ 1 order = 1 shop cho gọn (model có shop_id); giỏ nhiều shop → tách nhiều order là việc sau.

const dec = (n: number) => mongoose.Types.Decimal128.fromString((n || 0).toString());
const PLATFORM_FEE_RATE = 0.05; // ponytail: phí sàn 5% cố định; cấu hình hoá khi cần.

export class OrdersService {
    /** Tạo order từ giỏ hàng: [{ productId, variantId, quantity }]. */
    static async createOrder(buyerId: string, payload: any) {
        const items = Array.isArray(payload.items) ? payload.items : [];
        if (items.length === 0) throw new Error('Order phải có ít nhất 1 sản phẩm');
        if (!payload.shipping_address) throw new Error('Thiếu địa chỉ giao hàng');

        let shopId: mongoose.Types.ObjectId | null = null;
        const orderItems: any[] = [];
        let subtotal = 0;

        for (const it of items) {
            const product = await Product.findById(it.productId);
            if (!product) throw new Error(`Sản phẩm ${it.productId} không tồn tại`);
            const variant = await ProductVariant.findById(it.variantId);
            if (!variant) throw new Error(`Biến thể ${it.variantId} không tồn tại`);
            if (shopId && shopId.toString() !== product.shop_id.toString()) {
                throw new Error('Đơn hàng chỉ hỗ trợ 1 shop mỗi lần (MVP)');
            }
            shopId = product.shop_id;

            const qty = Math.max(1, Number(it.quantity) || 1);
            const retail = parseFloat(variant.retail_price.toString());
            subtotal += retail * qty;

            // POD: gắn design + options để Printer in. Lấy từ design_placement đầu tiên.
            const placement = product.design_placements?.[0];
            let designUrl: string | undefined;
            if (placement) {
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
                design_file_url: designUrl,
                // giữ tạm meta phôi + placement để dispatch (không đổi schema).
                custom_notes: JSON.stringify({
                    sku: variant.sku,
                    blank_id: product.blank_id,
                    design_options: placement ? { scale: placement.scale, rotation: placement.rotation, align: 'center' } : undefined,
                }),
            });
        }

        const shippingFee = Number(payload.shipping_fee) || 0;
        const platformFee = subtotal * PLATFORM_FEE_RATE;
        const order = await Order.create({
            buyer_id: new mongoose.Types.ObjectId(buyerId),
            shop_id: shopId,
            order_code: `VC-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`,
            payment_method: payload.payment_method || 'COD',
            payment_status: 'PENDING',
            order_status: 'ORDERED',
            shipping_address: payload.shipping_address,
            shipping_details: { shipping_fee: dec(shippingFee) },
            items: orderItems,
            financial_breakdown: {
                subtotal: dec(subtotal),
                shipping_fee: dec(shippingFee),
                coupon_discount: dec(0),
                platform_fee: dec(platformFee),
                seller_payout_amount: dec(subtotal - platformFee),
            },
            status_history: [{ status: 'ORDERED', changed_at: new Date(), note: 'Đơn được tạo' }],
            order_hour_of_week: new Date().getDay() * 24 + new Date().getHours(),
        });
        return order;
    }

    static async getOrder(id: string, buyerId: string) {
        const order = await Order.findById(id);
        if (!order) throw new Error('Order not found');
        if (order.buyer_id.toString() !== buyerId) throw new Error('Order not found'); // ẩn của người khác
        return order;
    }

    static async getOrdersByBuyer(buyerId: string) {
        return Order.find({ buyer_id: new mongoose.Types.ObjectId(buyerId) }).sort({ created_at: -1 }).lean();
    }

    /** Cổng thanh toán callback: 'success' → PAID + dispatch sang Printer. Nếu không → CANCELLED. */
    static async processPaymentCallback(id: string, gatewayStatus: string) {
        const order = await Order.findById(id);
        if (!order) throw new Error('Order not found');

        if (gatewayStatus === 'success') {
            order.payment_status = 'PAID';
            order.order_status = 'PROCESSING';
            order.status_history.push({ status: 'PROCESSING', changed_at: new Date(), note: 'Đã thanh toán' } as any);
            await order.save();
            // Đẩy sang xưởng in (không chặn phản hồi thanh toán nếu Printer lỗi).
            dispatchToPrinter(order).catch((err: any) => console.error('[DISPATCH] lỗi gửi đơn sang Printer:', err.message));
            return { status: 'paid', orderCode: order.order_code };
        } else {
            order.payment_status = 'PENDING';
            order.order_status = 'CANCELLED';
            order.status_history.push({ status: 'CANCELLED', changed_at: new Date(), note: 'Thanh toán thất bại' } as any);
            await order.save();
            return { status: 'cancelled' };
        }
    }
}
export default OrdersService;
