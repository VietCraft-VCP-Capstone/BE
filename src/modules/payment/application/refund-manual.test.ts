import assert from 'node:assert/strict';
import test from 'node:test';
import { RefundExecutionError, RefundExecutionService, type RefundContext, type RefundExecutionRepository, type RefundGateway, type RefundGatewayResult } from './refund-execution.service';
import type { PaymentRefundRecord, PaymentRefundStatus } from '../infrastructure/refund-execution.model';

const ctx: RefundContext = { orderId: 'o1', orderCode: 'VC-1', buyerId: 'u1', paymentMethod: 'PAYOS', paymentStatus: 'PAID', simulated: false, paidAmount: 40100, originalTransactionId: 'FT1', transactionDate: '', destination: { bin: '970415', accountNo: '1012345678' } };
const input = { orderId: 'o1', businessKey: 'rq1', amount: 40100, reason: 'r', createdBy: 'seller' };

class Repo implements RefundExecutionRepository {
    rec?: PaymentRefundRecord; materialized: PaymentRefundRecord[] = []; recorded: PaymentRefundStatus[] = []; locked = false;
    constructor(status?: PaymentRefundStatus) { if (status) this.rec = { _id: 'e1', business_key: 'rq1', order_id: 'o1', amount: 40100, status, gateway_request_id: 'g1', created_at: new Date(), updated_at: new Date() }; }
    async loadContext() { return ctx; }
    async findOrCreate() { return (this.rec ||= { _id: 'e1', business_key: 'rq1', order_id: 'o1', amount: 40100, status: 'READY', gateway_request_id: 'g1', created_at: new Date(), updated_at: new Date() }); }
    async claim() { return true; }
    async lockOrder() { if (this.locked) return false; this.locked = true; return true; }
    async refundedAmount() { return 0; }
    async recordResult(_id: string, status: PaymentRefundStatus, r: Partial<RefundGatewayResult>) { this.recorded.push(status); Object.assign(this.rec!, { status, gateway_response: r.data ?? this.rec!.gateway_response }); }
    async releaseOrder() { this.locked = false; }
    async materializeSuccess(_c: RefundContext, r: PaymentRefundRecord) { this.materialized.push(r); }
}
const gw = (query: () => Promise<RefundGatewayResult>): RefundGateway => ({ refund: async () => { throw new Error('không được gọi chi tiền'); }, query });

test('thủ công: chưa từng gửi lệnh chi thì ghi nhận ngay, Transaction mang mã GD người bán nhập', async () => {
    const repo = new Repo();
    const r = await new RefundExecutionService(repo, gw(async () => { throw new Error('không được hỏi'); })).settleManually(input, { reference: ' FT999 ', settledBy: 'seller' });
    assert.equal(r.status, 'REFUNDED');
    assert.equal(repo.materialized[0].gateway_response?.manual, true);
    assert.equal(repo.materialized[0].gateway_response?.reference, 'FT999');
});

test('thủ công: lệnh chi trước chưa rõ kết quả, payOS xác nhận KHÔNG có lệnh chi thì cho xác nhận tay', async () => {
    const repo = new Repo('PENDING');
    const r = await new RefundExecutionService(repo, gw(async () => ({ status: 'FAILED', data: {} }))).settleManually(input, { reference: 'FT1', settledBy: 's' });
    assert.equal(r.status, 'REFUNDED');
    assert.equal(repo.materialized[0].gateway_response?.manual, true);
});

test('thủ công: payOS đã chi thật thì ghi theo payOS, KHÔNG ghi chuyển tay (chống hoàn hai lần)', async () => {
    const repo = new Repo('PENDING');
    const r = await new RefundExecutionService(repo, gw(async () => ({ status: 'SUCCEEDED', data: { payoutId: 'po1', reference: 'FT-PAYOS' } }))).settleManually(input, { reference: 'FT-TAY', settledBy: 's' });
    assert.equal(r.status, 'REFUNDED');
    assert.equal(repo.materialized[0].gateway_response?.manual, undefined);
    assert.equal(repo.materialized[0].gateway_response?.reference, 'FT-PAYOS');
});

test('thủ công: payOS còn đang chi hoặc không hỏi được thì từ chối (409), không ghi gì', async () => {
    for (const query of [async () => ({ status: 'PENDING' as const, data: { payoutId: 'po1' } }), async () => { throw new Error('403'); }]) {
        const repo = new Repo('PENDING');
        await assert.rejects(new RefundExecutionService(repo, gw(query as any)).settleManually(input, { reference: 'FT1', settledBy: 's' }), (e: any) => e instanceof RefundExecutionError && e.statusCode === 409);
        assert.equal(repo.materialized.length, 0);
    }
});

test('thủ công: thiếu mã giao dịch hoặc đang gửi lệnh chi thì từ chối', async () => {
    await assert.rejects(new RefundExecutionService(new Repo(), gw(async () => ({ status: 'FAILED', data: {} }))).settleManually(input, { reference: '  ', settledBy: 's' }), /mã giao dịch/);
    await assert.rejects(new RefundExecutionService(new Repo('PROCESSING'), gw(async () => ({ status: 'FAILED', data: {} }))).settleManually(input, { reference: 'FT1', settledBy: 's' }), /đang gửi lệnh chi/);
});

test('đối soát: payOS trả PENDING không kèm dữ liệu thì KHÔNG ghi lại (giữ mốc thời gian chờ, tránh kẹt vĩnh viễn)', async () => {
    const repo = new Repo('PENDING');
    const r = await new RefundExecutionService(repo, gw(async () => ({ status: 'PENDING', data: {} }))).execute(input);
    assert.equal(r.status, 'PENDING');
    assert.deepEqual(repo.recorded, []);
});

test('PROCESSING quá hạn (tiến trình chết giữa lúc gửi lệnh chi): hỏi lại cổng, không kẹt và không chi lại mù', async () => {
    const repo = new Repo('PROCESSING');
    repo.rec!.updated_at = new Date(Date.now() - 3 * 60 * 1000);
    let queried = 0;
    const r = await new RefundExecutionService(repo, gw(async () => { queried++; return { status: 'SUCCEEDED', data: { payoutId: 'po1', reference: 'FT-X' } }; })).execute(input);
    assert.equal(queried, 1);
    assert.equal(r.status, 'REFUNDED');
    assert.equal(repo.materialized.length, 1);
});

test('PROCESSING còn mới: vẫn coi là đang gửi lệnh, không hỏi cổng', async () => {
    const repo = new Repo('PROCESSING');
    const r = await new RefundExecutionService(repo, gw(async () => { throw new Error('không được hỏi'); })).execute(input);
    assert.equal(r.status, 'PROCESSING');
});
