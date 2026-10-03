import assert from 'node:assert/strict';
import test from 'node:test';
import { mapDbOrderToResponse } from './order.dto';

test('maps status simulation marker to the buyer order response', () => {
    const response = mapDbOrderToResponse({
        _id: 'mongo-id',
        order_code: 'TEST-STATUS-source-id',
        buyer_id: 'buyer-id',
        shop_id: 'shop-id',
        order_status: 'SHIPPING',
        payment_method: 'COD',
        payment_status: 'PENDING',
        is_status_simulation: true,
        items: [],
        financial_breakdown: {},
        shipping_details: {},
    });

    assert.equal(response.isStatusSimulation, true);
});

test('keeps normal orders marked as non-simulation', () => {
    const response = mapDbOrderToResponse({
        _id: 'mongo-id', order_code: 'VC-100', buyer_id: 'buyer-id', shop_id: 'shop-id',
        order_status: 'ORDERED', payment_method: 'COD', payment_status: 'PENDING',
        items: [], financial_breakdown: {}, shipping_details: {},
    });
    assert.equal(response.isStatusSimulation, false);
});
