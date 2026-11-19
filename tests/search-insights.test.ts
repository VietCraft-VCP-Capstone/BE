import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aboutProduct, actualRank, matchGain, queryInsights, zeroResultInsights } from '../src/modules/analytics/application/search-gap-match';

test('vị trí thật là thứ tự 1-based trong danh sách đã xếp hạng; không có trong top thì null', () => {
    assert.equal(actualRank(['a', 'b', 'c'], 'a'), 1);
    assert.equal(actualRank(['a', 'b', 'c'], 'b'), 2);
    assert.equal(actualRank(['a', 'b'], 'z'), null);
});

test('match_gain: thiếu trong tiêu đề +5, có tiêu đề thiếu tag +3, đủ cả hai 0; không phân biệt dấu', () => {
    assert.equal(matchGain('túi da bò', 'Ví nam', []), 5);
    assert.equal(matchGain('túi da bò', 'Túi da bò', ['da']), 3);
    assert.equal(matchGain('túi da bò', 'Túi da bò', ['túi da bò']), 0);
    assert.equal(matchGain('tui da bo', 'TÚI DA BÒ', []), 3);
});

test('xếp hạng từ khoá: nhiều lượt tìm đứng trước; từ đã phủ thì không có match_gain', () => {
    const out = queryInsights([
        { query: 'ví nam', searches: 5, actual_rank: null },
        { query: 'túi xách', searches: 9, actual_rank: 3 },
        { query: 'túi da bò', searches: 4, actual_rank: null },
    ], 'Túi xách da thật', ['da']);
    assert.deepEqual(out, [
        { query: 'túi xách', searches: 9, covered: true, actual_rank: 3, match_gain: 0 },
        { query: 'ví nam', searches: 5, covered: false, actual_rank: null, match_gain: 5 },
        { query: 'túi da bò', searches: 4, covered: false, actual_rank: null, match_gain: 5 },
    ]);
});

test('covered là quy tắc từ vựng trên tiêu đề + tags, không phụ thuộc vị trí trong top', () => {
    const covered = queryInsights([{ query: 'túi xách', searches: 4, actual_rank: null }], 'Túi xách da thật', []);
    assert.deepEqual(covered, [{ query: 'túi xách', searches: 4, covered: true, actual_rank: null, match_gain: 0 }]);
    const ranked = queryInsights([{ query: 'túi da bò', searches: 4, actual_rank: 3 }], 'Túi xách da thật', ['da']);
    assert.deepEqual(ranked, [{ query: 'túi da bò', searches: 4, covered: false, actual_rank: 3, match_gain: 5 }]);
    assert.equal(queryInsights([{ query: 'bình gốm', searches: 2, actual_rank: null }], 'Bình hoa', ['gốm'])[0].covered, true);
});

test('zero-result: chỉ giữ từ khoá có chung từ với danh mục, kèm match_gain', () => {
    const out = zeroResultInsights([
        { query: 'bình gốm', searches: 6 },
        { query: 'áo thun', searches: 9 },
        { query: 'gốm sứ thủ công', searches: 3 },
    ], 'Gốm sứ', 'Bình hoa', ['gốm']);
    assert.deepEqual(out, [
        { query: 'bình gốm', searches: 6, match_gain: 5 },
        { query: 'gốm sứ thủ công', searches: 3, match_gain: 5 },
    ]);
});

test('đường đi search insights chỉ đọc: không SearchLog.create, không gọi ProductsService.search', () => {
    const src = readFileSync(join(__dirname, '../src/modules/analytics/application/listing-search-gaps.service.ts'), 'utf8');
    assert.doesNotMatch(src, /SearchLog\.(create|insertMany|save|updateOne|updateMany|bulkWrite)|new SearchLog/);
    assert.doesNotMatch(src, /ProductsService/);
    assert.match(src, /findSearchHits\(/);
    assert.match(src, /buildSearchPipeline\(/);
});

test('khách tìm không ra kết quả: không ghép nhầm "trắng" với "thời trang" hay chỉ trùng 1 từ', () => {
    const rows = [
        { query: 'váy trắng', searches: 5 },
        { query: 'áo đồng phục', searches: 412 },
        { query: 'đồng hồ dây da', searches: 3 },
    ];
    const out = zeroResultInsights(rows, 'Trang sức', 'Đồng hồ thời trang nam nữ dây cao su', []);
    assert.deepEqual(out.map(r => r.query), ['đồng hồ dây da']);
});

test('từ khoá chỉ trùng từ chung chung (nam, nữ, màu) không được coi là liên quan', () => {
    const watch = ['Trang sức', 'Đồng hồ thời trang nam nữ dây cao su', []] as const;
    assert.equal(aboutProduct('dép nam', ...watch), false);
    assert.equal(aboutProduct('vòng nam', ...watch), false);
    assert.equal(aboutProduct('đồng hồ nam', ...watch), true);
    assert.equal(aboutProduct('thun oversize', 'Áo thun', 'Áo thun nam nữ form rộng', []), true);
});
