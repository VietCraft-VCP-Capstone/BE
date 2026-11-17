import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcCouponDiscount, computeOrderTotals } from '../src/modules/promotion/application/coupon-math';
import { reserveVariantStock } from '../src/modules/order/application/stock-reservation';

test('mã ship: giảm tối đa bằng phí ship, giá trị 0 = miễn phí toàn bộ', () => {
    assert.deepEqual(calcCouponDiscount('FREE_SHIPPING', 50000, 0, 189000, 37700), { discount: 37700, target: 'SHIPPING' });
    assert.deepEqual(calcCouponDiscount('FREE_SHIPPING', 15000, 0, 189000, 37700), { discount: 15000, target: 'SHIPPING' });
    assert.deepEqual(calcCouponDiscount('FREE_SHIPPING', 0, 0, 189000, 37700), { discount: 37700, target: 'SHIPPING' });
});

test('mã hàng: % có trần, cố định không vượt tiền hàng', () => {
    assert.equal(calcCouponDiscount('PERCENTAGE', 20, 30000, 189000, 0).discount, 30000);
    assert.equal(calcCouponDiscount('PERCENTAGE', 10, 0, 189000, 0).discount, 18900);
    assert.equal(calcCouponDiscount('FIXED_AMOUNT', 500000, 0, 189000, 0).discount, 189000);
    assert.equal(calcCouponDiscount('FLASH_SALE', 50, 0, 100000, 0).discount, 50000);
    assert.equal(calcCouponDiscount('BUNDLE', 25000, 0, 100000, 0).discount, 25000);
    assert.equal(calcCouponDiscount('FIXED_AMOUNT', 10000, 0, 189000, 37700).target, 'PRODUCT');
});

test('áp đồng thời 2 mã: tách dòng, tổng đúng như ví dụ Shopee', () => {
    // 189.000 hàng + 37.700 ship − 37.700 ưu đãi ship − 64.016 voucher hàng = 124.984
    assert.deepEqual(computeOrderTotals(189000, 37700, 64016, 37700), {
        productDiscount: 64016, shippingDiscount: 37700, couponDiscount: 101716, total: 124984,
    });
});

test('tổng không bao giờ âm, giảm ship không vượt phí ship', () => {
    const t = computeOrderTotals(50000, 20000, 999999, 999999);
    assert.equal(t.productDiscount, 50000);
    assert.equal(t.shippingDiscount, 20000);
    assert.equal(t.total, 0);
    assert.equal(computeOrderTotals(50000, 0, 0, 30000).shippingDiscount, 0);
});

/** Model giả: updateOne có điều kiện $gte giống Mongo, đủ để kiểm logic giữ/hoàn kho. */
function fakeModel(stock: Record<string, number>) {
    return {
        stock,
        async updateOne(filter: any, update: any) {
            const id = String(filter._id);
            const need = filter.stock_quantity?.$gte;
            if (!(id in stock) || (need !== undefined && stock[id] < need)) return { modifiedCount: 0 };
            stock[id] += update.$inc.stock_quantity;
            return { modifiedCount: 1 };
        },
    } as any;
}

test('trừ kho đúng SKU đã chọn, không đụng SKU khác', async () => {
    const m = fakeModel({ setVayAo_S: 5, leAo_S: 3, leVay_M: 2 });
    await reserveVariantStock([{ variant_id: 'leAo_S', quantity: 2 }, { variant_id: 'leVay_M', quantity: 2 }], m);
    assert.deepEqual(m.stock, { setVayAo_S: 5, leAo_S: 1, leVay_M: 0 });
});

test('hụt kho 1 SKU thì báo lỗi và hoàn lại các SKU đã trừ', async () => {
    const m = fakeModel({ a: 5, b: 1 });
    await assert.rejects(
        reserveVariantStock([{ variant_id: 'a', quantity: 2 }, { variant_id: 'b', quantity: 3, title: 'Váy' }], m),
        /không đủ hàng/,
    );
    assert.deepEqual(m.stock, { a: 5, b: 1 });
});
