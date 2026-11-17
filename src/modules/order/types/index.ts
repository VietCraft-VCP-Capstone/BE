
export interface OrderItemReview {
    id: string;
    rating: number;
    comment: string;
    images: string[];
    createdAt?: Date | string;
    updatedAt?: Date | string;
}

export interface OrderItem {
    order_item_id?: string;
    productId: string;
    variantId: string;
    quantity: number;
    price: number;
    title?: string;
    color?: string;
    size?: string;
    image?: string;
    is_reviewed?: boolean;
    review?: OrderItemReview | null;
}

export interface OrderResponse {
    id: string;
    _id?: string;
    orderCode?: string;
    buyerId: string;
    items: OrderItem[];
    totalAmount: number;
    status: 'pending' | 'paid' | 'shipping' | 'completed' | 'cancelled';
    paymentGateway: 'payos' | 'cod';
    paymentMethod?: string;
    shippingProvider: 'ghn' | 'ghtk';
    shippingCode?: string;
    createdAt: Date;
    shopId?: string;
    shopName?: string;
    shopLogo?: string;
    shippingFee?: number;
    discount?: number;
    couponCode?: string | null;
    paymentStatus?: 'PENDING' | 'PAID' | 'REFUNDED';
    /** Thời điểm cổng thanh toán xác nhận tiền về; null với đơn chưa trả hoặc dữ liệu cũ. */
    paidAt?: Date | null;
    isStatusSimulation?: boolean;
    is_reviewed?: boolean;
    isPod?: boolean;
    orderType?: string;
    fulfillmentStatus?: string;
    sellerApprovalStatus?: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
    printerInfo?: {
        printerId?: string;
        printerName?: string;
        supplierOrderId?: string;
        printerStatus?: string;
        rejectionReason?: string;
    };
    shippingAddress?: {
        recipient_name: string;
        phone: string;
        address_detail: string;
    };
}


export const DEFAULT_SHIPPING_FEE = 30000;
export const PAYMENT_METHODS = ['PAYOS', 'COD'];
export const SHIPPING_CARRIERS = ['ghn', 'ghtk'];
// Shop chưa có logo: để trống cho FE hiện chữ cái đầu, không dùng ảnh Unsplash không liên quan
export const PLACEHOLDER_SHOP_LOGO = '';
// Đường dẫn tương đối tới ảnh trong FE/public — trước đây gắn cứng http://localhost:5173 nên hỏng khi deploy
export const PLACEHOLDER_ITEM_IMAGE = '/image-not-found.jpg';

