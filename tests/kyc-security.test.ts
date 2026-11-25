import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { saveEncryptedKycFile, KYC_STORAGE_ROOT } from '../src/shared/upload/kyc-storage.middleware';
import { decryptBuffer, getKycEncryptionKey } from '../src/shared/utils/crypto.service';
import { redactUrl } from '../src/app/middleware/request-id.middleware';

function withEnv(env: { NODE_ENV?: string; KYC_ENCRYPTION_KEY?: string }, fn: () => void) {
    const old = { NODE_ENV: process.env.NODE_ENV, KYC_ENCRYPTION_KEY: process.env.KYC_ENCRYPTION_KEY };
    const set = (v: Record<string, string | undefined>) => {
        for (const [k, val] of Object.entries(v)) val === undefined ? delete process.env[k] : (process.env[k] = val);
    };
    set({ NODE_ENV: undefined, KYC_ENCRYPTION_KEY: undefined, ...env });
    try { fn(); } finally { set(old); }
}

test('khóa KYC: không đặt NODE_ENV hoặc production mà thiếu khóa thì từ chối, không rơi về khóa công khai', () => {
    withEnv({}, () => assert.throws(getKycEncryptionKey, /KYC_ENCRYPTION_KEY/));
    withEnv({ NODE_ENV: 'production' }, () => assert.throws(getKycEncryptionKey, /KYC_ENCRYPTION_KEY/));
    withEnv({ NODE_ENV: 'development' }, () => assert.equal(getKycEncryptionKey().length, 32));
});

test('ảnh CCCD ghi xuống đĩa đã mã hóa và giải mã lại đúng', () => {
    withEnv({ KYC_ENCRYPTION_KEY: 'khoa-test-chi-dung-trong-test-0123456789' }, () => {
        const raw = Buffer.from('noi dung anh cccd gia lap');
        const name = saveEncryptedKycFile('user123', { mimetype: 'image/png', buffer: raw });
        const full = path.join(KYC_STORAGE_ROOT, name);
        try {
            assert.match(name, /^kyc_user123_[0-9a-f-]+\.png$/);
            const disk = fs.readFileSync(full);
            assert.equal(disk.subarray(0, 4).toString(), 'EK2:');
            assert.equal(disk.includes(raw), false);
            assert.deepEqual(decryptBuffer(disk), raw);
        } finally {
            fs.unlinkSync(full);
        }
    });
});

test('log request che token xem ảnh', () => {
    assert.equal(redactUrl('/api/seller/kyc/files/a.png?token=abc.def'), '/api/seller/kyc/files/a.png?token=***');
    assert.equal(redactUrl('/x?a=1&token=abc&b=2'), '/x?a=1&token=***&b=2');
    assert.equal(redactUrl('/products?page=2'), '/products?page=2');
});
