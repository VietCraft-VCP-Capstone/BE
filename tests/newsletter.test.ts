import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, NewsletterValidationError } from '../src/modules/newsletter/application/newsletter.service';

test('email hợp lệ được chuẩn hoá: bỏ khoảng trắng, viết thường', () => {
    assert.equal(normalizeEmail('  Khach.Hang+tin@Example.COM '), 'khach.hang+tin@example.com');
});

test('email rác bị từ chối', () => {
    for (const bad of ['', '   ', 'abc', 'a@b', 'a b@c.vn', '<script>@x.vn', null, undefined, 42, `${'a'.repeat(250)}@x.vn`]) {
        assert.throws(() => normalizeEmail(bad), NewsletterValidationError, String(bad));
    }
});
