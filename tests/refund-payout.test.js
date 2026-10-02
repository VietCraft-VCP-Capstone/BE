const test = require('node:test');
const assert = require('node:assert/strict');
const { dist, isolateEnv } = require('./helpers/refund-test-env');
const { createFakePayout } = require('./helpers/fake-payos-payout');

isolateEnv();
const { APIError, ConnectionError } = require('@payos/node');
const { PayOSPayoutService } = dist('modules/refund/application/payos-payout.service.js');

const apiError = (status, code, desc) => APIError.generateError(status, { code, desc }, desc, new Headers());

function refund(patch = {}) {
    return {
        _id: 'rf0000000000000000000001',
        order_code: 'VC-1759461234567-1234',
        amount: 150000,
        attempt_count: 1,
        provider_reference: 'rf-VC-1759461234567-1234',
        destination: { bank_bin: '970436', account_no: '0123456789', account_name: 'NGUYEN VAN A' },
        executed_at: new Date(),
        updated_at: new Date(),
        ...patch,
    };
}

function setup() {
    const fake = createFakePayout();
    const service = new PayOSPayoutService();
    service.useClient(fake);
    return { fake, service };
}

test('reference ổn định theo mã đơn và số lần thử', () => {
    const { service } = setup();
    assert.equal(service.referenceFor('VC-1759461234567-1234', 1), 'rf-VC-1759461234567-1234');
    assert.equal(service.referenceFor('VC-1759461234567-1234', 2), 'rf-VC-1759461234567-1234-r2');
});

test('execute: tạo payout với reference và idempotency key theo lần thử', async () => {
    const { fake, service } = setup();
    const result = await service.execute(refund());
    assert.equal(result.outcome, 'PENDING');
    assert.ok(result.payoutId);
    assert.equal(fake.createCalls.length, 1);
    assert.deepEqual(
        { ...fake.createCalls[0], description: undefined },
        {
            referenceId: 'rf-VC-1759461234567-1234',
            amount: 150000,
            description: undefined,
            toBin: '970436',
            toAccountNumber: '0123456789',
            idempotencyKey: 'refund-rf0000000000000000000001-attempt-1',
        },
    );
    assert.match(fake.createCalls[0].description, /^REFUND VC-1759461234567-1234$/);
});

test('execute: payout đã có dưới reference thì nhận lại, không tạo payout thứ hai (edge 10/13)', async () => {
    const { fake, service } = setup();
    fake.seed('rf-VC-1759461234567-1234', 150000, 'SUCCEEDED');
    const result = await service.execute(refund());
    assert.equal(result.outcome, 'SUCCESS');
    assert.equal(fake.createCalls.length, 0);
});

test('execute: số dư ví thiếu thì FAILED và không gửi payout (edge 12)', async () => {
    const { fake, service } = setup();
    fake.balance = 1000;
    const result = await service.execute(refund());
    assert.deepEqual(
        { outcome: result.outcome, failureReason: result.failureReason },
        { outcome: 'FAILED', failureReason: 'insufficient_wallet_balance' },
    );
    assert.equal(fake.createCalls.length, 0);
});

test('execute: API số dư lỗi thì vẫn tạo payout', async () => {
    const { fake, service } = setup();
    fake.balanceError = new ConnectionError('balance down');
    const result = await service.execute(refund());
    assert.equal(result.outcome, 'PENDING');
    assert.equal(fake.createCalls.length, 1);
});

test('execute: payOS nhận payout rồi mới rớt kết nối thì lookup và nhận lại (A12)', async () => {
    const { fake, service } = setup();
    fake.createError = { error: new ConnectionError('socket hang up'), afterAccept: true };
    const result = await service.execute(refund());
    assert.equal(result.outcome, 'PENDING');
    assert.equal(result.payoutId, fake.payout('rf-VC-1759461234567-1234').id);
});

test('execute: mất kết nối và không tìm thấy payout thì UNKNOWN, không FAILED', async () => {
    const { fake, service } = setup();
    fake.createError = { error: new ConnectionError('socket hang up') };
    const result = await service.execute(refund());
    assert.equal(result.outcome, 'UNKNOWN');
});

test('execute: create và lookup sau đó đều lỗi thì UNKNOWN', async () => {
    const { fake, service } = setup();
    fake.createError = { error: apiError(400, '20', 'Tài khoản không hợp lệ') };
    const list = fake.payouts.list;
    let calls = 0;
    fake.payouts.list = async params => {
        calls += 1;
        if (calls > 1) throw new ConnectionError('list down');
        return list(params);
    };
    const result = await service.execute(refund());
    assert.equal(result.outcome, 'UNKNOWN');
});

test('execute: lỗi nghiệp vụ payOS trả HTTP 200 code khác 00 là từ chối dứt khoát', async () => {
    const { fake, service } = setup();
    fake.createError = { error: apiError(200, '231', 'Số dư không đủ để thực hiện giao dịch') };
    const result = await service.execute(refund());
    assert.deepEqual(
        { outcome: result.outcome, failureReason: result.failureReason },
        { outcome: 'FAILED', failureReason: 'insufficient_wallet_balance' },
    );

    fake.createError = { error: apiError(200, '214', 'Ngân hàng nhận không hỗ trợ') };
    const rejected = await service.execute(refund({ provider_reference: 'rf-VC-1759461234567-1234-r2' }));
    assert.deepEqual(
        { outcome: rejected.outcome, failureReason: rejected.failureReason },
        { outcome: 'FAILED', failureReason: 'payout_rejected:214' },
    );
});

test('execute: 4xx là từ chối, nhưng trùng idempotency key / 5xx / 429 là chưa rõ', async () => {
    const cases = [
        [apiError(400, '20', 'Tài khoản không hợp lệ'), 'FAILED'],
        [apiError(400, '409', 'Idempotency key đã tồn tại'), 'UNKNOWN'],
        [apiError(502, '99', 'Bad gateway'), 'UNKNOWN'],
        [apiError(429, '98', 'Too many requests'), 'UNKNOWN'],
    ];
    for (const [error, expected] of cases) {
        const { fake, service } = setup();
        fake.createError = { error };
        const result = await service.execute(refund());
        assert.equal(result.outcome, expected, error.message);
    }
});

test('poll: theo payoutId, trả mã giao dịch ngân hàng làm evidence', async () => {
    const { fake, service } = setup();
    const created = await service.execute(refund());
    fake.settle('rf-VC-1759461234567-1234', 'FT26276123456');
    const result = await service.poll(refund({ provider_payout_id: created.payoutId }));
    assert.deepEqual(
        { outcome: result.outcome, evidenceRef: result.evidenceRef },
        { outcome: 'SUCCESS', evidenceRef: 'FT26276123456' },
    );
});

test('poll: chưa thấy payout thì PENDING trong 2 phút grace, sau đó FAILED payout_not_found', async () => {
    const { service } = setup();
    const fresh = await service.poll(refund({ executed_at: new Date() }));
    assert.equal(fresh.outcome, 'PENDING');
    const stale = await service.poll(refund({ executed_at: new Date(Date.now() - 3 * 60_000) }));
    assert.deepEqual(
        { outcome: stale.outcome, failureReason: stale.failureReason },
        { outcome: 'FAILED', failureReason: 'payout_not_found' },
    );
});

test('poll: payOS báo lỗi thì UNKNOWN, giữ nguyên trạng thái', async () => {
    const { fake, service } = setup();
    fake.listError = new ConnectionError('down');
    const result = await service.poll(refund());
    assert.equal(result.outcome, 'UNKNOWN');
});

test('findLive: ưu tiên payout SUCCESS ở bất kỳ lần thử nào, bỏ qua payout FAILED', async () => {
    const { fake, service } = setup();
    await service.execute(refund());
    fake.fail('rf-VC-1759461234567-1234');
    assert.equal(await service.findLive(refund({ attempt_count: 2 })), null);

    fake.seed('rf-VC-1759461234567-1234-r2', 150000, 'PROCESSING');
    assert.equal((await service.findLive(refund({ attempt_count: 2 }))).outcome, 'PENDING');

    fake.settle('rf-VC-1759461234567-1234-r2');
    assert.equal((await service.findLive(refund({ attempt_count: 2 }))).outcome, 'SUCCESS');
});

test('initialize: health-check lỗi thì tự hạ xuống MANUAL_VIETQR (edge 1)', async () => {
    const healthy = setup();
    await healthy.service.initialize();
    assert.equal(healthy.service.activeExecutor(), 'PAYOS_PAYOUT');

    const broken = setup();
    broken.fake.balanceError = apiError(403, '401', 'IP không nằm trong whitelist');
    await broken.service.initialize();
    assert.equal(broken.service.activeExecutor(), 'MANUAL_VIETQR');
    assert.equal(broken.service.status().degraded, true);
    assert.match(broken.service.status().degradedReason, /^payout_unavailable:/);
});
