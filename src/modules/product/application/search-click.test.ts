import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchClick } from './search-click';

const ids = { logId: '64b7f0c2a1b2c3d4e5f60718', productId: '64b7f0c2a1b2c3d4e5f60719' };

test('parseSearchClick nhận body hợp lệ', () => {
    const r = parseSearchClick({ ...ids, position: 3 });
    assert.equal(r?.logId.toString(), ids.logId);
    assert.equal(r?.productId.toString(), ids.productId);
    assert.equal(r?.position, 3);
});

test('parseSearchClick từ chối id sai và position không hợp lệ', () => {
    assert.equal(parseSearchClick({ ...ids, logId: 'aaaaaaaaaaaa', position: 0 }), null);
    assert.equal(parseSearchClick({ ...ids, productId: undefined, position: 0 }), null);
    assert.equal(parseSearchClick({ ...ids, position: -1 }), null);
    assert.equal(parseSearchClick({ ...ids, position: 1.5 }), null);
    assert.equal(parseSearchClick({ ...ids, position: '2' }), null);
    assert.equal(parseSearchClick({ ...ids, position: 1000 }), null);
    assert.equal(parseSearchClick(null), null);
});
