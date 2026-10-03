import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidRefundVideoBuffer, validateRefundEvidence } from './refund-evidence-policy';

test('accepts valid MP4, WebM, and AVI signatures and rejects invalid video data', () => {
    assert.equal(isValidRefundVideoBuffer(Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])), true);
    assert.equal(isValidRefundVideoBuffer(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), true);
    const avi = Buffer.alloc(12); avi.write('RIFF', 0); avi.writeUInt32LE(4, 4); avi.write('AVI ', 8);
    assert.equal(isValidRefundVideoBuffer(avi), true);
    assert.equal(isValidRefundVideoBuffer(Buffer.from('not a video')), false);
});

test('requires a non-empty reason category', () => {
    assert.throws(() => validateRefundEvidence('', 'Visible damage', ['/uploads/refunds/damage.jpg']), /lý do/i);
});

test('requires a written explanation', () => {
    assert.throws(() => validateRefundEvidence('DAMAGED', '  ', ['/uploads/refunds/damage.jpg']), /mô tả/i);
});

test('requires at least one image or video', () => {
    assert.throws(() => validateRefundEvidence('OTHER', 'Item issue', []), /minh chứng/i);
});

test('allows up to three images and one video', () => {
    assert.doesNotThrow(() => validateRefundEvidence('OTHER', 'Item issue', [
        '/uploads/refunds/a.jpg', '/uploads/refunds/b.webp', '/uploads/refunds/c.png', '/uploads/refunds/clip.mp4',
    ]));
});

test('rejects more than three images', () => {
    assert.throws(() => validateRefundEvidence('OTHER', 'Item issue', [
        '/uploads/refunds/a.jpg', '/uploads/refunds/b.jpg', '/uploads/refunds/c.jpg', '/uploads/refunds/d.jpg',
    ]), /tối đa 3 ảnh/i);
});

test('rejects more than one video', () => {
    assert.throws(() => validateRefundEvidence('OTHER', 'Item issue', [
        '/uploads/refunds/a.mp4', '/uploads/refunds/b.webm',
    ]), /tối đa 1 video/i);
});

test('rejects media URLs not uploaded to the refund evidence folder', () => {
    assert.throws(() => validateRefundEvidence('OTHER', 'Item issue', ['https://example.com/damage.jpg']), /đã tải lên/i);
});

test('permits empty evidence only for the explicit development test flow', () => {
    assert.doesNotThrow(() => validateRefundEvidence('OTHER', 'Test only description', [], { allowEmptyEvidenceForTest: true }));
});
