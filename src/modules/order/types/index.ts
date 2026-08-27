/** Item trong payload FE gửi lên. `price` (nếu có) chỉ để hiển thị — BE không bao giờ tin. */
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

/** Shape đơn hàng trả về cho FE (khác hẳn document Mongo — xem mapDbOrderToResponse). */
export interface OrderResponse {
    id: string;
    buyerId: string;
    items: OrderItem[];
    totalAmount: number;
    status: 'pending' | 'paid' | 'shipping' | 'completed' | 'cancelled';
    paymentGateway: 'vnpay' | 'momo';
    paymentMethod?: string;
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


export const PLATFORM_FEE_RATE = 0.05;      // phí sàn 5% cố định; cấu hình hoá khi cần.
export const DEFAULT_SHIPPING_FEE = 30000;  // TODO: tính từ shipping_profile của shop thay vì hằng số.
export const PAYMENT_METHODS = ['VNPAY', 'MOMO', ];
export const SHIPPING_CARRIERS = ['ghn', 'ghtk'];
export const PLACEHOLDER_SHOP_LOGO = 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=80';
export const PLACEHOLDER_ITEM_IMAGE = 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=200';


        // Phí ship và giảm giá do server quyết định; client gửi lên không được tin.
