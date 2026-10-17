import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getTrendingKeywords, resetTrendingCache } from './trending-keywords';

const realFetch = globalThis.fetch;
let calls = 0;

const stubAi = (keywords: string[]) => {
    globalThis.fetch = (async () => {
        calls++;
        return { ok: true, json: async () => ({ data: { niches: keywords.map(keyword => ({ keyword })) } }) };
    }) as any;
};

const stubAiFail = () => {
    globalThis.fetch = (async () => {
        calls++;
        throw new Error('AI offline');
    }) as any;
};

afterEach(() => {
    globalThis.fetch = realFetch;
    resetTrendingCache();
    calls = 0;
});

test('limit khác nhau dùng chung một cache', async () => {
    stubAi(Array.from({ length: 10 }, (_, i) => `kw${i}`));
    assert.equal((await getTrendingKeywords(6)).length, 6);
    assert.equal((await getTrendingKeywords(8)).length, 8);
    assert.equal(calls, 1);
});

test('danh sách dự phòng hết hạn sau 60 giây', async (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    stubAiFail();
    assert.equal((await getTrendingKeywords())[0], 'Quà Tặng');
    t.mock.timers.tick(61_000);
    stubAi(['a1', 'a2', 'a3']);
    assert.equal((await getTrendingKeywords()).length, 3);
});

test('viết hoa chữ cái đầu và loại trùng', async () => {
    stubAi(['áo thun', 'Áo Thun']);
    assert.deepEqual(await getTrendingKeywords(), ['Áo Thun']);
});
