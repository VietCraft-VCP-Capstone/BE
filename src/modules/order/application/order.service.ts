export interface OrderItem {
    productId: string;
    variantId: string;
    quantity: number;
    price: number;
}

export interface Order {
    id: string;
    buyerId: string;
    items: OrderItem[];
    totalAmount: number;
    status: 'pending' | 'paid' | 'shipping' | 'completed' | 'cancelled';
    paymentGateway: 'vnpay' | 'momo';
    shippingProvider: 'ghn' | 'ghtk';
    shippingCode?: string;
    createdAt: Date;
    shopName?: string;
    shopLogo?: string;
}

const mockOrders: Order[] = [];

export class OrdersService {
    static async createOrder(buyerId: string, payload: any) {
        const { items, paymentGateway, shippingProvider, shopName, shopLogo } = payload;

        let totalAmount = 0;
        for (const item of items) {
            totalAmount += (item.price * item.quantity);
        }

        const newOrder: Order = {
            id: `ord_${Math.floor(Math.random() * 900000) + 100000}`,
            buyerId,
            items,
            totalAmount,
            status: 'pending',
            paymentGateway: paymentGateway || 'vnpay',
            shippingProvider: shippingProvider || 'ghn',
            createdAt: new Date(),
            shopName: shopName || 'VietCraft Shop',
            shopLogo: shopLogo || 'https://images.unsplash.com/photo-1513151233558-d860c5398176?auto=format&fit=crop&w=40'
        };

        mockOrders.push(newOrder);
        return newOrder;
    }

    static async getOrder(id: string, buyerId: string) {
        const order = mockOrders.find(o => o.id === id);
        if (!order) throw new Error('Order not found');
        return order;
    }

    static async getOrdersByBuyer(buyerId: string) {
        return mockOrders.filter(o => o.buyerId === buyerId);
    }

    static async processPaymentCallback(id: string, gatewayStatus: string) {
        const order = mockOrders.find(o => o.id === id);
        if (!order) throw new Error('Order not found');

        if (gatewayStatus === 'success') {
            order.status = 'paid';

            const trackingCode = `${order.shippingProvider.toUpperCase()}${Math.floor(Math.random() * 100000000)}`;
            order.shippingCode = trackingCode;
            order.status = 'shipping';
            return { status: 'paid', shippingTracking: trackingCode };
        } else {
            order.status = 'cancelled';
            return { status: 'cancelled' };
        }
    }
}
export default OrdersService;
