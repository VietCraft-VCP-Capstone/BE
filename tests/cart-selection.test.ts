import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySelection, normalizeItemIds } from '../src/modules/cart/utils';

const rows = () => [
    { _id: 'a', is_selected: true },
    { _id: 'b', is_selected: true },
    { _id: 'c', is_selected: false },
];

test('đặt đúng tập được chọn, chỉ đếm dòng đổi trạng thái', () => {
    const items = rows();
    const changed = applySelection(items, ['c']);
    assert.deepEqual(items.map(i => i.is_selected), [false, false, true]);
    assert.equal(changed, 3);
});

test('danh sách rỗng bỏ chọn tất cả; gọi lại không đổi gì', () => {
    const items = rows();
    applySelection(items, []);
    assert.deepEqual(items.map(i => i.is_selected), [false, false, false]);
    assert.equal(applySelection(items, []), 0);
});

test('id lạ bị bỏ qua, không thêm dòng', () => {
    const items = rows();
    applySelection(items, ['a', 'zzz']);
    assert.equal(items.length, 3);
    assert.deepEqual(items.map(i => i.is_selected), [true, false, false]);
});

test('chuẩn hoá id: bỏ trùng, bỏ rỗng, chặn body sai', () => {
    assert.deepEqual(normalizeItemIds(['a', ' a ', '', 3, 'b']), ['a', 'b']);
    assert.throws(() => normalizeItemIds('a'));
    assert.throws(() => normalizeItemIds(Array.from({ length: 201 }, (_, i) => `id${i}`)));
});
