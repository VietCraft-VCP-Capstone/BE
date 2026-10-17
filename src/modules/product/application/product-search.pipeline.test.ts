import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRelevance, buildSearchPipeline } from './product-search.pipeline';

const base = { norm: 'ao', qLower: 'áo', queryHasTone: true };

test('buildRelevance: chỉ bản chính dùng textScore, rating lấy từ _rating', () => {
    assert.ok(!JSON.stringify(buildRelevance({ ...base, withTextScore: false })).includes('textScore'));
    assert.ok(JSON.stringify(buildRelevance({ ...base, withTextScore: true })).includes('textScore'));
    assert.ok(JSON.stringify(buildRelevance({ ...base, withTextScore: true })).includes('$_rating'));
});

test('buildRelevance không có điều kiện regex khi không có từ khóa', () => {
    const json = JSON.stringify(buildRelevance({ norm: '', qLower: '', queryHasTone: false, withTextScore: false }));
    assert.ok(!json.includes('$regexMatch'));
});

test('buildSearchPipeline phân trang đúng và loại shop RESTRICTED', () => {
    const stages = buildSearchPipeline({}, {}, {}, 2, 12) as any[];
    const facet = stages.find(s => s.$facet).$facet;
    assert.deepEqual(facet.items[0], { $skip: 12 });
    assert.ok(JSON.stringify(stages).includes('RESTRICTED'));
});
