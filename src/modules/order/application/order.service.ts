import mongoose from 'mongoose';
import { Order, IOrder } from '../infrastructure/models/order.model';
import { Shop } from '../../product/infrastructure/models/shop.model';

export interface OrderItem {
    productId: string;
    variantId: string;
    quantity: number;
    price: number;
    title?: string;
    color?: string;
    size?: string;
    image?: string;
}

export interface Order {
    id: string;
    buyerId: string;
    items: OrderItem[];
    totalAmount: number;
    status: 'pending' | 'paid' | 'shipping' | 'completed' | 'cancelled';
    paymentGateway: 'vnpay' | 'momo' | 'cod';
    shippingProvider: 'ghn' | 'ghtk';
    shippingCode?: string;
    createdAt: Date;
    shopName?: string;
    shopLogo?: string;
    shippingFee?: number;
    paymentStatus?: 'PENDING' | 'PAID' | 'REFUNDED';
    shippingAddress?: {
        recipient_name: string;
        phone: string;
        address_detail: string;
    };
}

function mapDbOrderToResponse(dbOrder: any): Order {
    const subtotal = dbOrder.financial_breakdown?.subtotal ? Number(dbOrder.financial_breakdown.subtotal.toString()) : 0;
    const shippingFee = dbOrder.financial_breakdown?.shipping_fee ? Number(dbOrder.financial_breakdown.shipping_fee.toString()) : 0;
    const discount = dbOrder.financial_breakdown?.coupon_discount ? Number(dbOrder.financial_breakdown.coupon_discount.toString()) : 0;
    const totalAmount = subtotal + shippingFee - discount;

    let feStatus: 'pending' | 'paid' | 'shipping' | 'completed' | 'cancelled' = 'pending';
    switch (dbOrder.order_status) {
        case 'ORDERED':
        case 'PENDING_DESIGN':
            feStatus = 'pending';
            break;
        case 'PROCESSING':
            feStatus = 'paid';
            break;
        case 'SHIPPING':
            feStatus = 'shipping';
            break;
        case 'DELIVERED':
            feStatus = 'completed';
            break;
        case 'CANCELLED':
            feStatus = 'cancelled';
            break;
    }

    return {
        id: dbOrder.order_code,
        buyerId: dbOrder.buyer_id?.toString() || '',
        shopName: dbOrder.shop_id?.shop_name || 'VietCraft Shop',
        shopLogo: dbOrder.shop_id?.logo || 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=80',
        items: (dbOrder.items || []).map((it: any) => ({
            productId: it.product_id?.toString() || '',
            variantId: it.variant_id?.toString() || '',
            title: it.title,
            color: it.color,
            size: it.size,
            quantity: it.quantity,
            price: it.retail_price ? Number(it.retail_price.toString()) : 0,
            image: it.image || 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=200'
        })),
        totalAmount: totalAmount,
        shippingFee: shippingFee,
        status: feStatus,
        paymentGateway: dbOrder.payment_method?.toLowerCase() || 'vnpay',
        shippingProvider: dbOrder.shipping_details?.carrier?.toLowerCase() || 'ghn',
        shippingCode: dbOrder.shipping_details?.tracking_number,
        paymentStatus: dbOrder.payment_status,
        createdAt: dbOrder.created_at || dbOrder.createdAt || new Date(),
        shippingAddress: {
            recipient_name: dbOrder.shipping_address?.recipient_name || '',
            phone: dbOrder.shipping_address?.phone || '',
            address_detail: dbOrder.shipping_address?.address_detail || ''
        }
    };
}

export class OrdersService {
    static async createOrder(buyerId: string, payload: any) {
        const { items, paymentGateway, shippingProvider, shopName, shopLogo, shippingAddress, totalAmount, shippingFee } = payload;

        // 1. Tìm hoặc tạo Shop mẫu để làm khóa ngoại
        let shop = await Shop.findOne({ shop_name: shopName });
        if (!shop) {
            shop = await Shop.findOne();
        }
        if (!shop) {
            shop = await Shop.create({
                owner_id: new mongoose.Types.ObjectId(),
                shop_name: shopName || 'Xưởng In Sài Gòn',
                slug: 'xuong-in-sai-gon-' + Date.now(),
                logo: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&w=80',
                wallet_balance: mongoose.Types.Decimal128.fromString('0'),
                listing_count: 0,
                average_rating: 0
            });
        }

        // 2. Tính toán tài chính
        const computedSubtotal = items.reduce((acc: number, it: any) => acc + (it.price * it.quantity), 0);
        const computedShippingFee = shippingFee || 30000;
        const discount = payload.discount || 0;

        const orderCode = `LMN-${Math.floor(Math.random() * 90000) + 10000}`;
        const now = new Date();
        const orderHourOfWeek = now.getDay() * 24 + now.getHours();

        // Chuyển sang ObjectId hợp lệ
        const toValidObjectId = (idStr: string) => {
            return mongoose.Types.ObjectId.isValid(idStr) ? new mongoose.Types.ObjectId(idStr) : new mongoose.Types.ObjectId();
        };

        const newOrder = new Order({
            buyer_id: toValidObjectId(buyerId),
            shop_id: shop._id,
            order_code: orderCode,
            payment_method: (paymentGateway || 'COD').toUpperCase(),
            payment_status: paymentGateway === 'cod' ? 'PENDING' : 'PAID',
            order_status: 'ORDERED',
            shipping_address: {
                recipient_name: shippingAddress?.recipient_name || 'Người nhận',
                phone: shippingAddress?.phone || '0900000000',
                address_detail: shippingAddress?.address_detail || 'Địa chỉ giao hàng',
                province_id: shippingAddress?.province_id || '79',
                district_id: shippingAddress?.district_id || '760',
                ward_code: shippingAddress?.ward_code || '26734'
            },
            shipping_details: {
                carrier: shippingProvider || 'ghn',
                tracking_number: '',
                shipping_fee: mongoose.Types.Decimal128.fromString(computedShippingFee.toString())
            },
            items: items.map((it: any) => ({
                product_id: toValidObjectId(it.productId),
                variant_id: toValidObjectId(it.variantId),
                title: it.title || 'Sản phẩm mới',
                color: it.color || 'Mặc định',
                size: it.size || '',
                quantity: it.quantity,
                base_cost: mongoose.Types.Decimal128.fromString((it.price * 0.7).toFixed(0)),
                retail_price: mongoose.Types.Decimal128.fromString(it.price.toString()),
                image: it.image
            })),
            financial_breakdown: {
                subtotal: mongoose.Types.Decimal128.fromString(computedSubtotal.toString()),
                shipping_fee: mongoose.Types.Decimal128.fromString(computedShippingFee.toString()),
                coupon_discount: mongoose.Types.Decimal128.fromString(discount.toString()),
                platform_fee: mongoose.Types.Decimal128.fromString((computedSubtotal * 0.05).toFixed(0)),
                seller_payout_amount: mongoose.Types.Decimal128.fromString((computedSubtotal * 0.95).toFixed(0))
            },
            status_history: [
                {
                    status: 'ORDERED',
                    changed_at: new Date(),
                    note: 'Đơn hàng đã được tạo thành công'
                }
            ],
            order_hour_of_week: orderHourOfWeek
        });

        await newOrder.save();

        const populatedOrder = await Order.findById(newOrder._id).populate('shop_id');
        return mapDbOrderToResponse(populatedOrder);
    }

    static async getOrder(id: string, buyerId: string) {
        const query: any = {
            $or: [
                { order_code: id },
                { _id: mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null }
            ]
        };

        if (mongoose.Types.ObjectId.isValid(buyerId)) {
            query.buyer_id = new mongoose.Types.ObjectId(buyerId);
        }

        const order = await Order.findOne(query).populate('shop_id');
        if (!order) throw new Error('Không tìm thấy đơn hàng');

        return mapDbOrderToResponse(order);
    }

    static async getOrdersByBuyer(buyerId: string, status?: string) {
        const query: any = {};
        
        if (mongoose.Types.ObjectId.isValid(buyerId)) {
            query.buyer_id = new mongoose.Types.ObjectId(buyerId);
        }

        if (status && status !== 'all' && status !== 'ALL') {
            switch (status.toLowerCase()) {
                case 'pending':
                    query.order_status = { $in: ['ORDERED', 'PENDING_DESIGN'] };
                    break;
                case 'paid':
                    query.order_status = 'PROCESSING';
                    break;
                case 'shipping':
                    query.order_status = 'SHIPPING';
                    break;
                case 'completed':
                    query.order_status = 'DELIVERED';
                    break;
                case 'cancelled':
                    query.order_status = 'CANCELLED';
                    break;
            }
        }

        const orders = await Order.find(query).populate('shop_id').sort({ created_at: -1 });
        return orders.map(mapDbOrderToResponse);
    }

    static async processPaymentCallback(id: string, gatewayStatus: string) {
        const query: any = {
            $or: [
                { order_code: id },
                { _id: mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null }
            ]
        };

        const order = await Order.findOne(query).populate('shop_id');
        if (!order) throw new Error('Không tìm thấy đơn hàng');

        if (gatewayStatus === 'success') {
            order.payment_status = 'PAID';
            order.order_status = 'SHIPPING';
            const carrier = order.shipping_details?.carrier || 'ghn';
            const trackingCode = `${carrier.toUpperCase()}${Math.floor(Math.random() * 100000000)}`;
            
            order.shipping_details = {
                carrier,
                tracking_number: trackingCode,
                shipping_fee: order.shipping_details?.shipping_fee || mongoose.Types.Decimal128.fromString('30000')
            };

            order.status_history.push({
                status: 'SHIPPING',
                changed_at: new Date(),
                note: 'Thanh toán thành công. Đơn hàng chuyển sang vận chuyển.'
            });
        } else {
            order.order_status = 'CANCELLED';
            order.status_history.push({
                status: 'CANCELLED',
                changed_at: new Date(),
                note: 'Thanh toán thất bại. Đơn hàng tự động hủy.'
            });
        }

        await order.save();
        return mapDbOrderToResponse(order);
    }
}
export default OrdersService;
