import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestDeliveredOrder } from './test-order.factory';

const source = {
    buyer_id: 'buyer', shop_id: 'shop', payment_method: 'VNPAY' as const,
    shipping_address: {}, shipping_details: {}, items: [{}], financial_breakdown: {}, order_hour_of_week: 10,
};

test('builds a clearly marked delivered test order without claiming payment', () => {
    const now = new Date('2026-09-26T00:00:00Z');
    const order = buildTestDeliveredOrder(source, now);
    assert.equal(order.order_status, 'DELIVERED');
    assert.equal(order.payment_status, 'PENDING');
    assert.equal(order.refund_status, 'NONE');
    assert.match(order.order_code, /^TEST-REFUND-/);
    assert.equal(order.status_history.at(-1)?.status, 'DELIVERED');
    assert.match(order.status_history.at(-1)?.note || '', /giả lập.*chỉ dùng test/i);
});
