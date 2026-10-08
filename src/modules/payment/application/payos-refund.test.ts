import assert from 'node:assert/strict';
import test from 'node:test';
import { PayosRefundGateway, classifyPayout, payoutDescription, payosPayoutReference, type PayosPayoutSdk } from './payos-refund.gateway';
import { RefundExecutionError, RefundExecutionService, type RefundContext, type RefundExecutionRepository } from './refund-execution.service';
import { PayosService } from './payos.service';
import type { PaymentRefundRecord, PaymentRefundStatus } from '../infrastructure/refund-execution.model';
import { config } from '../../../app/config';
import { toNapasBin } from '../domain/bank-codes';

config.payos.payoutClientId = 'id'; config.payos.payoutApiKey = 'key'; config.payos.payoutChecksumKey = 'sum';

const payout = (state: string, approval = 'PROCESSING', ref = 'rf-x'): any => ({
    id: 'po1', referenceId: ref, approvalState: approval, createdAt: '',
    transactions: [{ amount: 50000, state, reference: state === 'SUCCEEDED' ? 'FT123' : null, errorCode: null, errorMessage: null }],
});
const record = (over: Partial<PaymentRefundRecord> = {}): PaymentRefundRecord => ({
    _id: 'e1', business_key: 'b1', order_id: 'o1', amount: 50000, status: 'READY', gateway_request_id: 'abc123',
    created_at: new Date(), updated_at: new Date(), ...over,
});
const context = (over: Partial<RefundContext> = {}): RefundContext => ({
    orderId: 'o1', orderCode: 'VC-1-2', buyerId: 'u1', paymentMethod: 'PAYOS', paymentStatus: 'PAID', simulated: false,
    paidAmount: 50000, originalTransactionId: 'R1', transactionDate: '',
    destination: { bin: '970436', accountNo: '0123456789', accountName: 'NGUYEN VAN A' }, ...over,
});
const input = { orderId: 'o1', businessKey: 'b1', amount: 50000, reason: 'r', createdBy: 'x' };

function fakeSdk(opts: { created?: any; createError?: Error; listed?: any[]; got?: any; balance?: number; listError?: Error } = {}) {
    const calls = { create: [] as any[], idem: [] as string[] };
    const sdk = {
        payouts: {
            create: async (req: any, idem: string) => { calls.create.push(req); calls.idem.push(idem); if (opts.createError) throw opts.createError; return opts.created; },
            list: async () => { if (opts.listError) throw opts.listError; return { data: opts.listed || [] }; },
            get: async () => opts.got,
        },
        payoutsAccount: { balance: async () => ({ balance: String(opts.balance ?? 10_000_000) }) },
    } as unknown as PayosPayoutSdk;
    return { sdk, calls };
}

test('classifyPayout: SUCCEEDED/COMPLETED, FAILED và PENDING', () => {
    assert.equal(classifyPayout(payout('SUCCEEDED', 'COMPLETED')).status, 'SUCCEEDED');
    assert.equal(classifyPayout(payout('FAILED', 'FAILED')).status, 'FAILED');
    assert.equal(classifyPayout(payout('PROCESSING', 'REJECTED')).status, 'FAILED');
    assert.equal(classifyPayout(payout('PROCESSING')).status, 'PENDING');
    assert.equal(classifyPayout(payout('SUCCEEDED', 'COMPLETED')).data.reference, 'FT123');
});

test('refund: tạo payout đúng tài khoản/số tiền, idempotency key = reference, kết quả PENDING', async () => {
    const { sdk, calls } = fakeSdk({ created: payout('PROCESSING') });
    const result = await new PayosRefundGateway(sdk).refund(context(), record(), input);
    assert.equal(result.status, 'PENDING');
    assert.equal(calls.create[0].toBin, '970436');
    assert.equal(calls.create[0].toAccountNumber, '0123456789');
    assert.equal(calls.create[0].amount, 50000);
    assert.equal(calls.create[0].referenceId, payosPayoutReference(record()));
    assert.equal(calls.idem[0], calls.create[0].referenceId);
    assert.ok(calls.create[0].description.length <= 25, `mô tả ${calls.create[0].description.length} ký tự`);
});

test('refund: payout đã tồn tại theo reference thì nhận lại, không tạo lệnh chi thứ hai', async () => {
    const { sdk, calls } = fakeSdk({ listed: [payout('SUCCEEDED', 'COMPLETED', 'rf-abc123')] });
    const result = await new PayosRefundGateway(sdk).refund(context(), record(), input);
    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(calls.create.length, 0);
});

test('refund: ví payout thiếu số dư thì FAILED và không gọi create', async () => {
    const { sdk, calls } = fakeSdk({ balance: 1000, created: payout('PROCESSING') });
    const result = await new PayosRefundGateway(sdk).refund(context(), record(), input);
    assert.equal(result.status, 'FAILED');
    assert.equal(calls.create.length, 0);
});

test('refund: lỗi mạng khi create và payOS chưa có payout thì ném lỗi (execution ở lại PENDING, không đoán FAILED)', async () => {
    const { sdk } = fakeSdk({ createError: new Error('socket hang up') });
    await assert.rejects(new PayosRefundGateway(sdk).refund(context(), record(), input), /xác minh/);
});

test('refund: create lỗi nhưng payout đã tồn tại thì nhận lại kết quả thật', async () => {
    let listCalls = 0;
    const { sdk } = fakeSdk({ createError: new Error('timeout') });
    (sdk as any).payouts.list = async () => ({ data: ++listCalls === 1 ? [] : [payout('PROCESSING', 'PROCESSING', 'rf-abc123')] });
    const result = await new PayosRefundGateway(sdk).refund(context(), record(), input);
    assert.equal(result.status, 'PENDING');
});

test('refund: thiếu credential payout thì FAILED, không chuyển tiền', async () => {
    const saved = config.payos.payoutApiKey;
    config.payos.payoutApiKey = '';
    try {
        const result = await new PayosRefundGateway(fakeSdk().sdk).refund(context(), record(), input);
        assert.equal(result.status, 'FAILED');
    } finally { config.payos.payoutApiKey = saved; }
});

test('query: theo payoutId đã lưu; chưa thấy payout thì PENDING trong ân hạn, quá hạn thì FAILED', async () => {
    const gw = (got?: any) => new PayosRefundGateway(fakeSdk({ got }).sdk);
    assert.equal((await gw(payout('SUCCEEDED', 'COMPLETED')).query(context(), record({ gateway_response: { payoutId: 'po1' } }))).status, 'SUCCEEDED');
    assert.equal((await gw().query(context(), record())).status, 'PENDING');
    assert.equal((await gw().query(context(), record({ updated_at: new Date(Date.now() - 10 * 60_000) }))).status, 'FAILED');
});

class MemoryRepo implements RefundExecutionRepository {
    rec?: PaymentRefundRecord; materialized = 0; locked = false;
    constructor(private ctx: RefundContext) {}
    async loadContext() { return this.ctx; }
    async findOrCreate(i: any) { return (this.rec ||= record({ business_key: i.businessKey, amount: i.amount })); }
    async claim(r: PaymentRefundRecord) { if (!['READY', 'FAILED'].includes(r.status)) return false; r.status = 'PROCESSING'; this.rec = r; return true; }
    async lockOrder() { this.locked = true; return true; }
    async refundedAmount() { return 0; }
    async recordResult(_id: string, status: PaymentRefundStatus, result: any) { Object.assign(this.rec!, { status, gateway_response: result.data ?? this.rec!.gateway_response, error: result.error }); }
    async releaseOrder() { this.locked = false; }
    async materializeSuccess() { this.materialized += 1; }
}

test('service: PAYOS không có tài khoản nhận thì 422, chưa tạo execution và chưa gọi payOS', async () => {
    const repo = new MemoryRepo(context({ destination: undefined }));
    const { sdk, calls } = fakeSdk({ created: payout('PROCESSING') });
    await assert.rejects(new RefundExecutionService(repo, new PayosRefundGateway(sdk)).execute(input),
        (e: any) => e instanceof RefundExecutionError && e.statusCode === 422);
    assert.equal(repo.rec, undefined);
    assert.equal(calls.create.length, 0);
});

test('service: payout PENDING rồi lần chạy lại tra payOS và ghi nhận thành công đúng một lần', async () => {
    const repo = new MemoryRepo(context());
    const { sdk, calls } = fakeSdk({ created: payout('PROCESSING') });
    const gateway = new PayosRefundGateway(sdk);
    const service = new RefundExecutionService(repo, gateway);
    assert.equal((await service.execute(input)).status, 'PENDING');
    assert.equal(repo.materialized, 0);

    (sdk as any).payouts.get = async () => payout('SUCCEEDED', 'COMPLETED');
    assert.equal((await service.execute(input)).status, 'REFUNDED');
    assert.equal(repo.materialized, 1);
    assert.equal(calls.create.length, 1, 'không tạo payout thứ hai');
    assert.equal((await service.execute(input)).status, 'REFUNDED');
    assert.equal(calls.create.length, 1);
});

test('service: số tiền hoàn vượt số đã thanh toán bị chặn trước khi gọi payOS', async () => {
    const repo = new MemoryRepo(context({ paidAmount: 40000 }));
    const { sdk, calls } = fakeSdk({ created: payout('PROCESSING') });
    await assert.rejects(new RefundExecutionService(repo, new PayosRefundGateway(sdk)).execute(input), /vượt/);
    assert.equal(calls.create.length, 0);
});

test('resolveRefundDestination: lấy từ webhook; thiếu thì hỏi payOS; sai định dạng thì undefined', async () => {
    const svc = new PayosService();
    const good = { counterAccountBankId: '970436', counterAccountNumber: '0123 456 789', counterAccountName: 'A' };
    assert.deepEqual(await svc.resolveRefundDestination({}, { callback_payload: good }), { bin: '970436', accountNo: '0123456789', accountName: 'A' });

    svc.useClient({ paymentRequests: { get: async () => ({ transactions: [good] }) } } as any);
    assert.equal((await svc.resolveRefundDestination({ payos_order_codes: [1] }, { callback_payload: {} }))?.bin, '970436');

    svc.useClient({ paymentRequests: { get: async () => ({ transactions: [{ counterAccountBankId: 'Vietcombank', counterAccountNumber: '1' }] }) } } as any);
    assert.equal(await svc.resolveRefundDestination({ payos_order_codes: [1] }, { callback_payload: {} }), undefined);

    svc.useClient({ paymentRequests: { get: async () => { throw new Error('down'); } } } as any);
    assert.equal(await svc.resolveRefundDestination({ payos_order_codes: [1] }, { callback_payload: {} }), undefined);
});

test('toNapasBin: BIN 6 số giữ nguyên, CITAD 8 số quy theo mã ngân hàng, mã lạ thì không đoán', () => {
    assert.equal(toNapasBin('970436'), '970436');
    assert.equal(toNapasBin('01201001'), '970415'); // VietinBank, mã payOS trả thật trên đơn test
    assert.equal(toNapasBin('79307001'), '970416'); // ACB, chi nhánh TP.HCM
    assert.equal(toNapasBin('01311001'), '970422'); // MB Bank
    assert.equal(toNapasBin('79304001'), undefined); // 304: nguồn không ghi tên, không map
    assert.equal(toNapasBin('0120100'), undefined);
    assert.equal(toNapasBin(null), undefined);
});

test('resolveRefundDestination: payOS trả mã CITAD (01201001) vẫn ra đúng BIN VietinBank', async () => {
    const svc = new PayosService();
    const dest = await svc.resolveRefundDestination({}, { callback_payload: { counterAccountBankId: '01201001', counterAccountNumber: '101234567890', counterAccountName: 'NGUYEN VAN A' } });
    assert.deepEqual(dest, { bin: '970415', accountNo: '101234567890', accountName: 'NGUYEN VAN A' });
});

test('payoutDescription: luôn <= 25 ký tự (giới hạn payOS), giữ được mã đơn chuẩn', () => {
    assert.equal(payoutDescription('VC-1791445007611-1364'), 'HT VC-1791445007611-1364');
    assert.ok(payoutDescription('VC-1791445007611-1364-THEM-HAU-TO-DAI').length <= 25);
    assert.equal(payoutDescription('VC-1#2'), 'HT VC-12');
});
