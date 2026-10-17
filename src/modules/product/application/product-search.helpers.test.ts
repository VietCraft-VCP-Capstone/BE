import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldLogSearch } from './product-search.helpers';

test('shouldLogSearch chỉ ghi khi tìm kiếm gốc ở trang 1', () => {
    assert.equal(shouldLogSearch('áo thun', 1, { sort: 'relevance' }), true);
    assert.equal(shouldLogSearch('áo thun', 1, {}), true);
    assert.equal(shouldLogSearch('áo thun', 1, { sort: 'price_asc' }), false);
    assert.equal(shouldLogSearch('áo thun', 2, {}), false);
    assert.equal(shouldLogSearch('a', 1, {}), false);
    assert.equal(shouldLogSearch('áo', 1, { category: 'Gốm' }), false);
});
