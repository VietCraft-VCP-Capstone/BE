
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
    paymentGateway: 'vnpay' | 'payos';
    paymentMethod?: string;
    shippingProvider: 'ghn' | 'ghtk';
    shippingCode?: string;
    createdAt: Date;
    shopId?: string;
    shopName?: string;
    shopLogo?: string;
    shippingFee?: number;
    couponCode?: string | null;
    paymentStatus?: 'PENDING' | 'PAID' | 'REFUNDED';
    isStatusSimulation?: boolean;
    is_reviewed?: boolean;
    isPod?: boolean;
    orderType?: string;
    fulfillmentStatus?: string;
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


export const PLATFORM_FEE_RATE = 0.05;
export const DEFAULT_SHIPPING_FEE = 30000;
export const PAYMENT_METHODS = ['VNPAY', 'PAYOS'];
export const SHIPPING_CARRIERS = ['ghn', 'ghtk'];
export const PLACEHOLDER_SHOP_LOGO = 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=80';
export const PLACEHOLDER_ITEM_IMAGE = 'http://localhost:5173/image-not-found.jpg';

