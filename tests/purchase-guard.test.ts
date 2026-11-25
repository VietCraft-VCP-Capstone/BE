import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Shop } from '../src/modules/product/infrastructure/models/shop.model';
import { assertNotOwnProduct, OWN_PRODUCT_MESSAGE } from '../src/modules/product/application/purchase-guard';

const userId = new mongoose.Types.ObjectId().toString();
const shopId = new mongoose.Types.ObjectId();

function stubExists(result: unknown) {
    const original = Shop.exists;
    const calls: any[] = [];
    (Shop as any).exists = async (filter: any) => { calls.push(filter); return result; };
    return { calls, restore: () => { (Shop as any).exists = original; } };
}

test('người bán mua hàng của chính shop mình bị từ chối', async () => {
    const stub = stubExists({ _id: shopId });
    try {
        await assert.rejects(assertNotOwnProduct(userId, shopId), { message: OWN_PRODUCT_MESSAGE });
        assert.equal(String(stub.calls[0].owner_id), userId);
        assert.equal(String(stub.calls[0]._id), String(shopId));
    } finally { stub.restore(); }
});

test('mua hàng của shop khác được phép', async () => {
    const stub = stubExists(null);
    try {
        await assertNotOwnProduct(userId, shopId);
    } finally { stub.restore(); }
});

test('sản phẩm không gắn shop hoặc id người dùng lạ thì không tra cứu', async () => {
    const stub = stubExists({ _id: shopId });
    try {
        await assertNotOwnProduct(userId, null);
        await assertNotOwnProduct('khong-phai-objectid', shopId);
        assert.equal(stub.calls.length, 0);
    } finally { stub.restore(); }
});
