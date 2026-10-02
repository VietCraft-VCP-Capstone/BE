const test = require('node:test');
const assert = require('node:assert/strict');
const { dist, isolateEnv } = require('./helpers/refund-test-env');

isolateEnv();
const state = dist('modules/refund/domain/refund-state.js');
const eligibility = dist('modules/refund/domain/refund-eligibility.js');
const vietqr = dist('modules/refund/domain/vietqr.js');
const banks = dist('modules/refund/domain/bank-bins.js');
const ledger = dist('modules/refund/application/refund-ledger.service.js');

test('state machine: mọi cạnh hợp lệ đi được, mọi cạnh khác bị chặn (A15)', () => {
    const edges = {
        REQUESTED: ['APPROVED', 'REJECTED'],
        APPROVED: ['EXECUTING'],
        EXECUTING: ['SETTLED', 'FAILED'],
        FAILED: ['EXECUTING', 'CANCELED'],
        REJECTED: [],
        SETTLED: [],
        CANCELED: [],
    };
    for (const from of Object.keys(edges)) {
        for (const to of Object.keys(edges)) {
            const legal = edges[from].includes(to);
            assert.equal(state.canTransition(from, to), legal, `${from} -> ${to}`);
            if (legal) assert.doesNotThrow(() => state.assertTransition(from, to));
            else assert.throws(() => state.assertTransition(from, to));
        }
    }
});

test('ledger: refunding = hold - settled - released', () => {
    assert.deepEqual(
        ledger.computeLedgerTotals({ PAYMENT_IN: 120000, REFUND_HOLD: 120000 }),
        { paidIn: 120000, refunded: 0, refunding: 120000, available: 120000 },
    );
    assert.deepEqual(
        ledger.computeLedgerTotals({ PAYMENT_IN: 120000, REFUND_HOLD: 120000, REFUND_SETTLED: 120000 }),
        { paidIn: 120000, refunded: 120000, refunding: 0, available: 0 },
    );
    assert.deepEqual(
        ledger.computeLedgerTotals({ PAYMENT_IN: 120000, REFUND_HOLD: 120000, REFUND_RELEASED: 120000 }),
        { paidIn: 120000, refunded: 0, refunding: 0, available: 120000 },
    );
});

test('eligibility: lỗi đầu tiên thắng, window tính từ paid_at (A4)', () => {
    const paidAt = new Date('2026-10-03T00:00:00Z');
    const base = {
        paymentStatus: 'PAID',
        orderStatus: 'PROCESSING',
        paidAt,
        existingRefundStatus: null,
        windowSeconds: 300,
        now: new Date(paidAt.getTime() + 299_000),
    };
    const cases = [
        [{}, null],
        [{ now: new Date(paidAt.getTime() + 300_000) }, null],
        [{ now: new Date(paidAt.getTime() + 301_000) }, 'window_closed'],
        [{ paidAt: null }, 'payment_time_missing'],
        [{ paymentStatus: 'PENDING' }, 'not_paid'],
        [{ paymentStatus: 'REFUNDED', orderStatus: 'CANCELLED' }, 'already_refunded'],
        [{ orderStatus: 'CANCELLED' }, 'order_canceled'],
        [{ existingRefundStatus: 'REQUESTED' }, 'refund_in_progress'],
        [{ existingRefundStatus: 'FAILED' }, 'refund_in_progress'],
        [{ existingRefundStatus: 'SETTLED' }, 'already_refunded'],
        [{ existingRefundStatus: 'REJECTED' }, 'refund_canceled'],
        [{ existingRefundStatus: 'CANCELED' }, 'refund_canceled'],
        // Refund đã có được báo trước window: đơn đó đằng nào cũng không tạo thêm refund.
        [{ existingRefundStatus: 'EXECUTING', now: new Date(paidAt.getTime() + 999_000) }, 'refund_in_progress'],
    ];
    for (const [patch, expected] of cases) {
        assert.equal(eligibility.refundBlockedReason({ ...base, ...patch }), expected, JSON.stringify(patch));
    }
    assert.equal(
        eligibility.refundableUntil(paidAt, 300).toISOString(),
        '2026-10-03T00:05:00.000Z',
    );
});

test('VietQR: CRC16-CCITT-FALSE và cấu trúc payload', () => {
    assert.equal(vietqr.crc16('123456789'), '29B1');

    const payload = vietqr.buildVietQr('970436', '0123456789', 150000, 'HOAN VC17594612345671234');
    assert.ok(payload.startsWith('000201010212'));
    assert.ok(payload.includes('0010A000000727'));
    assert.ok(payload.includes('0006970436'));
    assert.ok(payload.includes('01100123456789'));
    assert.ok(payload.includes('0208QRIBFTTA'));
    assert.ok(payload.includes('5303704'));
    assert.ok(payload.includes('5406150000'));
    assert.ok(payload.includes('5802VN'));
    assert.ok(payload.includes('0824HOAN VC17594612345671234'));
    assert.equal(payload.slice(-8, -4), '6304');
    assert.equal(payload.slice(-4), vietqr.crc16(payload.slice(0, -4)));

    assert.equal(vietqr.sanitizeTransferContent('Hoàn tiền #VC-1/2'), 'Ho n ti n VC 1 2');
    assert.equal(vietqr.sanitizeTransferContent('A'.repeat(40)).length, 25);
    assert.throws(() => vietqr.buildVietQr('', '0123', 1000, 'x'));
});

test('bank BIN: nhận BIN 6 số, map mã viết tắt của shop sang BIN', () => {
    assert.equal(banks.isBin('970436'), true);
    assert.equal(banks.isBin('01201001'), false);
    assert.equal(banks.isBin('VCB'), false);
    assert.equal(banks.binOf('VCB'), '970436');
    assert.equal(banks.binOf('mb'), '970422');
    assert.equal(banks.binOf('970418'), '970418');
    assert.equal(banks.binOf('UNKNOWN'), undefined);
    assert.equal(banks.bankNameOf('970436'), 'Vietcombank');
    assert.equal(banks.bankNameOf('123456'), '123456');
});
