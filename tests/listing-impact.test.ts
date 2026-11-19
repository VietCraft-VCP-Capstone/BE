import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addDays, daysBetween, DaySnapshot, detectRevisions, didEffect, impactNumbers, impactStatus, isStableControl, mixedChanges, wilsonInterval,
} from '../src/modules/analytics/application/listing-impact';

const base = { title: 'Bình gốm', tags: ['gốm', 'bình'], n_images: 4, desc_words: 120, has_size: true, materials: ['gốm'], price: 189000 };
const day = (date: string, patch: Partial<typeof base> = {}): DaySnapshot => ({ date, snapshot: { ...base, ...patch } });

test('chỉ ghi nhận sửa đổi khi trường nội dung đổi; đổi thứ tự tags thì không tính', () => {
    const series = [
        day('2026-11-01'),
        day('2026-11-02'),
        day('2026-11-03', { tags: ['bình', 'gốm'] }),
        day('2026-11-04', { desc_words: 150 }),
        day('2026-11-05', { desc_words: 150, price: 209000 }),
    ];
    assert.deepEqual(detectRevisions(series), [
        { date: '2026-11-04', changed: ['desc_words'], price_changed: false },
        { date: '2026-11-05', changed: ['price'], price_changed: true },
    ]);
});

test('giai đoạn theo số ngày sau sửa: <7 đang thu thập, 7–13 sơ bộ (cửa sổ 7), ≥14 đầy đủ (cửa sổ 14)', () => {
    assert.deepEqual(impactStatus(6), { status: 'collecting', window: null });
    assert.deepEqual(impactStatus(7), { status: 'preliminary', window: 7 });
    assert.deepEqual(impactStatus(13), { status: 'preliminary', window: 7 });
    assert.deepEqual(impactStatus(14), { status: 'complete', window: 14 });
    assert.equal(daysBetween('2026-11-01', '2026-11-15'), 14);
    assert.equal(addDays('2026-02-27', 2), '2026-03-01');
});

test('DiD = (sau − trước) của sản phẩm trừ (sau − trước) của đối chứng', () => {
    assert.equal(didEffect({ pre: 10, post: 20 }, { pre: 10, post: 12 }), 8);
    assert.equal(didEffect({ pre: 10, post: 11 }, { pre: 10, post: 12 }), -1);
});

test('impactNumbers: lượt xem/ngày trước-sau và DiD đúng theo cửa sổ 7 ngày', () => {
    const treated = { '2026-11-05': { views: 70, carts: 7 }, '2026-11-12': { views: 140, carts: 14 } };
    const control = { '2026-11-03': { views: 70, carts: 0 }, '2026-11-14': { views: 84, carts: 0 } };
    const out = impactNumbers(treated, [control, control], '2026-11-10', 7);
    assert.deepEqual(out.views_per_day, { pre: 10, post: 20, control_pre: 10, control_post: 12, did: 8 });
    assert.equal(out.cart_rate.pre, 0.1);
    assert.equal(out.cart_rate.post, 0.1);
    const [lo, hi] = out.cart_rate.post_ci!;
    assert.ok(lo < 0.1 && hi > 0.1);
    assert.equal(impactNumbers(treated, [], '2026-11-10', 7).views_per_day, null);
});

test('đổi giá trong cùng cửa sổ thì mixed_changes = true; chỉ đổi nội dung một lần thì false', () => {
    const from = '2026-11-03';
    const to = '2026-11-17';
    assert.equal(mixedChanges([{ date: '2026-11-10', changed: ['desc_words'], price_changed: false }], from, to), false);
    assert.equal(mixedChanges([
        { date: '2026-11-10', changed: ['desc_words'], price_changed: false },
        { date: '2026-11-12', changed: ['price'], price_changed: true },
    ], from, to), true);
    assert.equal(mixedChanges([{ date: '2026-11-20', changed: ['price'], price_changed: true }], from, to), false);
});

test('khoảng Wilson 95% của 5/10 là 0.2366–0.7634; n = 0 thì null', () => {
    assert.deepEqual(wilsonInterval(5, 10), [0.2366, 0.7634]);
    assert.equal(wilsonInterval(0, 0), null);
});

test('đối chứng bị loại nếu không có snapshot trong cửa sổ hoặc có thay đổi trong cửa sổ', () => {
    assert.equal(isStableControl([day('2026-11-01'), day('2026-11-08'), day('2026-11-12')], '2026-11-03', '2026-11-17'), true);
    assert.equal(isStableControl([day('2026-11-01'), day('2026-11-10', { price: 1 })], '2026-11-03', '2026-11-17'), false);
    assert.equal(isStableControl([day('2026-11-01')], '2026-11-03', '2026-11-17'), false);
});
