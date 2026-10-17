import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKeywordSuggestions, phraseFromTitle } from './suggest-keywords';

test('phraseFromTitle lấy cụm từ tại chỗ khớp và thêm 1 từ phía sau', () => {
    assert.equal(phraseFromTitle('Bình Gốm Bát Tràng', ['binh']), 'bình gốm');
    assert.equal(phraseFromTitle('Set 2 bình hoa (men lam)', ['binh', 'h']), 'bình hoa men');
    assert.equal(phraseFromTitle('Ly sứ vẽ tay', ['gom']), null);
    assert.equal(phraseFromTitle('Ly sứ', []), null);
});

test('buildKeywordSuggestions: log trước, cụm phổ biến sau, gộp theo dạng không dấu', () => {
    const titles = ['Bình hoa gốm', 'Bình gốm men lam', 'Bình gốm Bát Tràng'];
    const r = buildKeywordSuggestions('binh', ['binh gom men', 'binh'], titles, []);
    assert.deepEqual(r, ['binh gom men', 'bình gốm', 'bình hoa']);
});

test('buildKeywordSuggestions ưu tiên bản có dấu, loại từ cấm, quá dài và giới hạn số lượng', () => {
    const r = buildKeywordSuggestions('binh', ['binh gom', 'bình độc hại', 'binh ' + 'x'.repeat(40)], ['Bình gốm'], ['doc hai']);
    assert.deepEqual(r, ['bình gốm']);
    const many = Array.from({ length: 10 }, (_, i) => `binh ${i}`);
    assert.equal(buildKeywordSuggestions('binh', many, [], [], 6).length, 6);
});
