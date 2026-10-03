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

test('maps persisted order item IDs without exposing snapshots', () => {
    const dbOrder = {
        _id: 'mongo-id', order_code: 'VC-101', buyer_id: 'buyer-id', shop_id: 'shop-id',
        order_status: 'DELIVERED', payment_method: 'COD', payment_status: 'PAID',
        items: [{ order_item_id: 'item-uuid-1', item_snapshot: { title: 'private snapshot' }, product_id: 'product-id', variant_id: 'variant-id', title: 'Product', quantity: 1, retail_price: 100 }],
        financial_breakdown: {}, shipping_details: {},
    };
    const first = mapDbOrderToResponse(dbOrder);
    const second = mapDbOrderToResponse(dbOrder);
    assert.equal(first.items[0].order_item_id, 'item-uuid-1');
    assert.equal(second.items[0].order_item_id, 'item-uuid-1');
    assert.equal('item_snapshot' in first.items[0], false);
});

test('leaves old order item ID absent and does not generate one during mapping', () => {
    const response = mapDbOrderToResponse({
        _id: 'mongo-id', order_code: 'VC-102', buyer_id: 'buyer-id', shop_id: 'shop-id',
        order_status: 'DELIVERED', payment_method: 'COD', payment_status: 'PAID',
        items: [{ product_id: 'product-id', variant_id: 'variant-id', title: 'Legacy product', quantity: 1, retail_price: 100 }],
        financial_breakdown: {}, shipping_details: {},
    });
    assert.equal(response.items[0].order_item_id, undefined);
});
