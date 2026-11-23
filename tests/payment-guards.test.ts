import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/app/config';
import { verifyPaymentCallback } from '../src/modules/order/presentation/order.router';
import { userRateLimit } from '../src/app/middleware/rate-limit.middleware';

function run(mw: any, req: any) {
    let status = 0;
    let nexted = false;
    const res: any = {
        setHeader() { },
        status(code: number) { status = code; return res; },
        json() { return res; },
    };
    mw(req, res, () => { nexted = true; });
    return { status, nexted };
}

test('callback thanh toán: thiếu secret thì từ chối ở mọi môi trường', () => {
    const old = { secret: config.paymentCallbackSecret, env: config.nodeEnv };
    config.paymentCallbackSecret = '';
    config.nodeEnv = 'development';
    try {
        assert.deepEqual(run(verifyPaymentCallback, { headers: {} }), { status: 503, nexted: false });
    } finally {
        config.paymentCallbackSecret = old.secret;
        config.nodeEnv = old.env;
    }
});

test('callback thanh toán: sai secret bị 401, đúng secret thì qua', () => {
    const old = config.paymentCallbackSecret;
    config.paymentCallbackSecret = 'bi-mat-test';
    try {
        assert.deepEqual(run(verifyPaymentCallback, { headers: { 'x-payment-callback-secret': 'sai' } }), { status: 401, nexted: false });
        assert.deepEqual(run(verifyPaymentCallback, { headers: { 'x-payment-callback-secret': 'bi-mat-test' } }), { status: 0, nexted: true });
    } finally {
        config.paymentCallbackSecret = old;
    }
});

test('giới hạn tần suất: quá số lần trong cửa sổ thì 429, IP khác không bị ảnh hưởng', () => {
    const limiter = userRateLimit(3, 60_000, 'quá nhiều');
    for (let i = 0; i < 3; i++) assert.equal(run(limiter, { ip: '1.1.1.1' }).nexted, true);
    assert.deepEqual(run(limiter, { ip: '1.1.1.1' }), { status: 429, nexted: false });
    assert.equal(run(limiter, { ip: '2.2.2.2' }).nexted, true);
});
