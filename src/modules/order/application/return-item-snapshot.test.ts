import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import test from 'node:test';
import { buildReturnItemSnapshot } from './return-item-snapshot';

const decimal = (value: number) => mongoose.Types.Decimal128.fromString(String(value));

test('paid item limits include coupon allocation and survive snapshot structuredClone', () => {
    const item = { title: 'Shirt', quantity: 2, retail_price: decimal(100000), item_snapshot: { price: decimal(100000), size: 'M' } };
    const result = buildReturnItemSnapshot({ financial_breakdown: { subtotal: decimal(400000), coupon_discount: decimal(80000) } }, item);
    assert.equal(result.valid, true);
    const snapshot = structuredClone(result.snapshot);
    assert.equal(snapshot.unit_price, 100000);
    assert.equal(snapshot.item_paid_amount_minor, 160000);
    assert.equal(snapshot.paid_unit_price_minor, 80000);
    assert.equal(snapshot.allocated_discount_minor, 40000);
    assert.equal(snapshot.ordered_quantity, 2);
    assert.equal(snapshot.currency, 'VND');
    assert.equal(snapshot.price, '100000');
});

test('invalid or missing monetary data never fabricates a positive refund limit', () => {
    for (const order of [{}, { financial_breakdown: { subtotal: decimal(100), coupon_discount: decimal(200) } }]) {
        const result = buildReturnItemSnapshot(order, { quantity: 1, retail_price: decimal(100) });
        assert.equal(result.valid, false);
        assert.equal(result.snapshot.item_paid_amount_minor, null);
    }
});
