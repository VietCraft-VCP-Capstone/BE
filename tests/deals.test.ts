import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestDeals } from '../src/modules/product/application/deals.service';

const SHOP = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const P = { _id: 'p1', shop_id: SHOP };
const coupon = (o: any) => ({ _id: o.code, title: o.code, shop_id: SHOP, applicable_scope: 'ALL', applicable_product_ids: [], min_order_value: null, max_discount_amount: null, ...o });

test('giảm % có trần: giá sau mã khớp công thức thanh toán', () => {
    const d = bestDeals([P], new Map([['p1', 1_000_000]]), [coupon({ code: 'FS', discount_type: 'FLASH_SALE', discount_value: 20, max_discount_amount: 50_000 })]).get('p1')!;
    assert.equal(d.savings, 50_000);
    assert.equal(d.finalPrice, 950_000);
    assert.equal(d.label, '-5%');
});

test('chọn mã tiết kiệm nhiều nhất, không phải mã đầu tiên', () => {
    const d = bestDeals([P], new Map([['p1', 500_000]]), [
        coupon({ code: 'A30', discount_type: 'FLASH_SALE', discount_value: 30_000 }),
        coupon({ code: 'B50', discount_type: 'FLASH_SALE', discount_value: 50_000 }),
    ]).get('p1')!;
    assert.equal(d.couponCode, 'B50');
    assert.equal(d.label, '-50K');
});

test('chưa đủ đơn tối thiểu thì không gắn giá tốt', () => {
    const m = bestDeals([P], new Map([['p1', 80_000]]), [coupon({ code: 'MIN', discount_type: 'FLASH_SALE', discount_value: 30_000, min_order_value: 100_000 })]);
    assert.equal(m.size, 0);
});

test('mã giảm % toàn shop không gắn lên sản phẩm; mã chỉ định thì có', () => {
    const shopWide = bestDeals([P], new Map([['p1', 200_000]]), [coupon({ code: 'PCT', discount_type: 'PERCENTAGE', discount_value: 10 })]);
    assert.equal(shopWide.size, 0);
    const specific = bestDeals([P], new Map([['p1', 200_000]]), [coupon({ code: 'SP', discount_type: 'PERCENTAGE', discount_value: 10, applicable_scope: 'SPECIFIC_PRODUCTS', applicable_product_ids: ['p1'] })]);
    assert.equal(specific.get('p1')!.finalPrice, 180_000);
});

test('mã của shop khác không áp cho sản phẩm này', () => {
    const m = bestDeals([P], new Map([['p1', 200_000]]), [coupon({ code: 'X', shop_id: OTHER, discount_type: 'FIXED_AMOUNT', discount_value: 20_000, applicable_scope: 'SPECIFIC_PRODUCTS', applicable_product_ids: ['p1'] })]);
    assert.equal(m.size, 0);
});
