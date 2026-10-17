import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVi, hasTone, extractSearchTerms, buildPrefixes } from './vietnamese-search.util';

test('normalizeVi bỏ dấu, đ và ký tự đặc biệt', () => {
    assert.equal(normalizeVi('Bộ Ly Gốm Mộc Men Lam (Set 2)'), 'bo ly gom moc men lam set 2');
    assert.equal(normalizeVi('Đèn ĐỎ'), 'den do');
    assert.equal(normalizeVi('Hòa'.normalize('NFD')), normalizeVi('Hòa'.normalize('NFC')));
    assert.equal(normalizeVi(undefined as any), '');
});

test('hasTone nhận biết ký tự có dấu', () => {
    assert.equal(hasTone('Bình'), true);
    assert.equal(hasTone('binh'), false);
});

test('extractSearchTerms bỏ trùng và giới hạn 8 từ', () => {
    assert.deepEqual(extractSearchTerms('Áo áo  THUN'), ['ao', 'thun']);
    assert.equal(extractSearchTerms('a b c d e f g h i j').length, 8);
});

test('buildPrefixes bỏ từ 1 ký tự và có tiền tố cụm 2 từ', () => {
    assert.deepEqual(buildPrefixes('a ly'), ['ly']);
    const prefixes = buildPrefixes('ly gom bat trang');
    assert.ok(prefixes.includes('go'));
    assert.ok(prefixes.includes('bat tr'));
    assert.ok(prefixes.includes('bat trang'));
    assert.ok(!prefixes.includes('b'));
});
