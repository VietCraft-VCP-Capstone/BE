import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldLogSearch, rankSuggestions } from './product-search.helpers';

test('shouldLogSearch chỉ ghi khi tìm kiếm gốc ở trang 1', () => {
    assert.equal(shouldLogSearch('áo thun', 1, { sort: 'relevance' }), true);
    assert.equal(shouldLogSearch('áo thun', 1, {}), true);
    assert.equal(shouldLogSearch('áo thun', 1, { sort: 'price_asc' }), false);
    assert.equal(shouldLogSearch('áo thun', 2, {}), false);
    assert.equal(shouldLogSearch('a', 1, {}), false);
    assert.equal(shouldLogSearch('áo', 1, { category: 'Gốm' }), false);
});

const hoaItems = () => [
    { title_norm: 'hoang dan' },
    { title_norm: 'binh hoa gom' },
    { title_norm: 'hoa sen', average_rating: 4.8, rating_count: 5 },
    { title_norm: 'den', tags_norm: ['hoa'] },
];

test('rankSuggestions: "hoa sen" đứng đầu, "binh hoa gom" trước tag-only', () => {
    const titles = rankSuggestions(hoaItems(), 'hoa', ['hoa']).map(i => i.title_norm);
    assert.equal(titles[0], 'hoa sen');
    assert.ok(titles.indexOf('binh hoa gom') < titles.indexOf('den'));
});

test('rankSuggestions trả tối đa 4 kết quả', () => {
    assert.equal(rankSuggestions([...hoaItems(), ...hoaItems()], 'hoa', ['hoa']).length, 4);
});

test('rankSuggestions: hòa điểm thì sản phẩm có đánh giá thật thắng', () => {
    const a = { title_norm: 'hoa a', average_rating: 5, rating_count: 0 };
    const b = { title_norm: 'hoa b', average_rating: 4.5, rating_count: 10 };
    assert.equal(rankSuggestions([a, b], 'hoa', ['hoa'])[0], b);
});
