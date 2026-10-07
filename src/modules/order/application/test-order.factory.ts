type TestOrderInput = {
    buyer_id: unknown;
    shop_id: unknown;
    payment_method: 'VNPAY' | 'MOMO' | 'COD';
    shipping_address: unknown;
    shipping_details: unknown;
    items: unknown[];
    financial_breakdown: unknown;
    order_hour_of_week: number;
};

export function buildTestDeliveredOrder(source: TestOrderInput, now = new Date()) {
    return {
        buyer_id: source.buyer_id,
        shop_id: source.shop_id,
        order_code: `TEST-REFUND-${now.getTime()}-${Math.floor(Math.random() * 9000 + 1000)}`,
        is_simulated: true,
        payment_method: source.payment_method,
        payment_status: 'PENDING' as const,
        refund_status: 'NONE' as const,
        order_status: 'DELIVERED' as const,
        shipping_address: source.shipping_address,
        shipping_details: source.shipping_details,
        items: source.items,
        financial_breakdown: source.financial_breakdown,
        status_history: [
            { status: 'ORDERED', changed_at: now, note: 'Đơn test Refund/Dispute' },
            { status: 'DELIVERED', changed_at: now, note: 'Giao hàng giả lập — chỉ dùng test Refund/Dispute' },
        ],
        order_hour_of_week: source.order_hour_of_week,
    };
}
