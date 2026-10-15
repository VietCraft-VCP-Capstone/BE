import crypto from 'crypto';
import type { PaymentRefundRecord, PaymentRefundStatus } from '../infrastructure/refund-execution.model';

export interface RefundContext {
    orderId: string; orderCode: string; buyerId: string; paymentMethod: string; paymentStatus: string;
    simulated: boolean; paidAmount: number; originalTransactionId: string; transactionDate: string;
    /** Tài khoản nhận tiền hoàn khi cổng thu tiền không tự hoàn về nguồn (payOS). */
    destination?: { bin: string; accountNo: string; accountName?: string };
}
export interface RefundExecutionInput { orderId: string; businessKey: string; amount: number; reason: string; createdBy: string; clientIp?: string }
export interface RefundGatewayResult { status: 'SUCCEEDED' | 'PENDING' | 'FAILED'; data: Record<string, any>; request?: Record<string, any>; error?: string }
export interface RefundGateway {
    refund(context: RefundContext, record: PaymentRefundRecord, input: RefundExecutionInput): Promise<RefundGatewayResult>;
    query(context: RefundContext, record: PaymentRefundRecord): Promise<RefundGatewayResult>;
}
export interface RefundExecutionRepository {
    loadContext(orderId: string): Promise<RefundContext>;
    findOrCreate(input: RefundExecutionInput): Promise<PaymentRefundRecord>;
    claim(record: PaymentRefundRecord): Promise<boolean>;
    lockOrder(orderId: string, executionId: string): Promise<boolean>;
    refundedAmount(orderId: string): Promise<number>;
    recordResult(id: string, status: PaymentRefundStatus, result: Partial<RefundGatewayResult>): Promise<void>;
    releaseOrder(orderId: string, executionId: string): Promise<void>;
    materializeSuccess(context: RefundContext, record: PaymentRefundRecord): Promise<void>;
}
/** Người bán tự chuyển khoản hoàn cho khách rồi xác nhận bằng mã giao dịch ngân hàng. */
export interface ManualSettlement { reference: string; settledBy: string; note?: string }

export interface RefundExecutionResult { executionId: string; status: 'REFUNDED' | 'PENDING' | 'PROCESSING' | 'FAILED'; amount: number; error?: string }
export class RefundExecutionError extends Error {
    constructor(message: string, readonly statusCode = 400) { super(message); }
}

/**
 * Một lần gửi lệnh chi (kể cả gateway tự retry) xong trong dưới một phút. Bản ghi còn
 * PROCESSING lâu hơn mức này nghĩa là tiến trình đã chết giữa chừng (BE khởi động lại,
 * crash): kết quả chưa rõ, phải hỏi lại cổng như PENDING chứ không được để kẹt mãi.
 */
export const PROCESSING_STALE_MS = 2 * 60 * 1000;
const isStaleProcessing = (record: PaymentRefundRecord, now = Date.now()) =>
    record.status === 'PROCESSING' && now - new Date(record.updated_at).getTime() > PROCESSING_STALE_MS;

/** The durable record and order lock are acquired before contacting the gateway. Unknown outcomes remain reserved. */
export class RefundExecutionService {
    constructor(private readonly repository: RefundExecutionRepository, private readonly gateway: RefundGateway) {}

    async execute(input: RefundExecutionInput): Promise<RefundExecutionResult> {
        if (!input.businessKey?.trim()) throw new RefundExecutionError('Thiếu mã yêu cầu hoàn tiền đã được duyệt.');
        if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new RefundExecutionError('Số tiền hoàn phải là số nguyên VND lớn hơn 0.');
        const context = await this.repository.loadContext(input.orderId);
        if (context.simulated) throw new RefundExecutionError('Đơn mô phỏng không phát sinh hoàn tiền.', 422);
        if (!['VNPAY', 'PAYOS'].includes(context.paymentMethod)) throw new RefundExecutionError('Phương thức này chưa tích hợp hoàn tiền tự động; tiền chưa được chuyển.', 422);
        if (context.paymentMethod === 'PAYOS' && !context.destination) throw new RefundExecutionError('Không xác định được tài khoản ngân hàng đã dùng để thanh toán; tiền chưa được chuyển.', 422);
        input = { ...input, orderId: context.orderId };
        const record = await this.repository.findOrCreate(input);
        if (record.order_id !== context.orderId || record.amount !== input.amount) throw new RefundExecutionError('Yêu cầu hoàn tiền đã lưu có đơn hoặc số tiền khác.', 409);
        const output = (status: RefundExecutionResult['status'], error?: string): RefundExecutionResult => ({ executionId: record._id, status, amount: record.amount, ...(error ? { error } : {}) });
        if (record.status === 'SUCCEEDED') {
            await this.repository.materializeSuccess(context, record);
            return output('REFUNDED');
        }
        if (record.status === 'PENDING' || isStaleProcessing(record)) {
            const stale = record.status === 'PROCESSING';
            // Querying is read-only at the gateway: a retry never repeats a transfer with an unknown outcome.
            let result: RefundGatewayResult;
            try { result = await this.gateway.query(context, record); }
            catch { return output('PENDING', 'Đang xác minh kết quả với cổng thanh toán.'); }
            // Vẫn chưa có gì mới thì không ghi lại: updated_at phải giữ mốc lần gửi lệnh, vì
            // gateway dựa vào nó để biết đã đợi đủ lâu chưa trước khi kết luận "chưa từng chi".
            if (stale || result.status !== 'PENDING' || Object.keys(result.data || {}).length) {
                await this.repository.recordResult(record._id, result.status, result);
            }
            if (result.status === 'SUCCEEDED') {
                await this.repository.materializeSuccess(context, { ...record, status: 'SUCCEEDED', gateway_response: result.data });
                return output('REFUNDED');
            }
            if (result.status === 'FAILED') await this.repository.releaseOrder(context.orderId, record._id);
            return output(result.status === 'FAILED' ? 'FAILED' : 'PENDING', result.error);
        }
        if (record.status === 'PROCESSING') return output('PROCESSING');
        if (context.paymentStatus !== 'PAID' && context.paymentStatus !== 'REFUNDED') throw new RefundExecutionError('Chỉ hoàn tiền cho đơn đã thanh toán.');
        if (!context.originalTransactionId) throw new RefundExecutionError('Không tìm thấy giao dịch thanh toán gốc.');
        if (!Number.isSafeInteger(context.paidAmount) || input.amount > context.paidAmount) throw new RefundExecutionError('Số tiền hoàn vượt số tiền đã thanh toán.');
        if (!await this.repository.claim(record)) return output('PROCESSING');
        if (!await this.repository.lockOrder(context.orderId, record._id)) {
            await this.repository.recordResult(record._id, 'FAILED', { error: 'Đơn đang có một giao dịch hoàn tiền khác cần xác minh.' });
            throw new RefundExecutionError('Đơn đang có một giao dịch hoàn tiền khác cần xác minh.', 409);
        }
        try {
            const refunded = await this.repository.refundedAmount(context.orderId);
            if (!Number.isSafeInteger(refunded) || input.amount > context.paidAmount - refunded) {
                await this.repository.recordResult(record._id, 'FAILED', { error: 'Tổng tiền hoàn vượt số tiền đã thanh toán.' });
                await this.repository.releaseOrder(context.orderId, record._id);
                throw new RefundExecutionError('Tổng tiền hoàn vượt số tiền đã thanh toán.');
            }
        } catch (error) {
            // No gateway request has been sent yet, so this failure can safely be retried.
            await this.repository.recordResult(record._id, 'FAILED', { error: error instanceof Error ? error.message : 'Không kiểm tra được số tiền đã hoàn.' });
            await this.repository.releaseOrder(context.orderId, record._id);
            throw error;
        }
        let result: RefundGatewayResult;
        try { result = await this.gateway.refund(context, record, input); }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Chưa xác định được kết quả từ cổng thanh toán.';
            await this.repository.recordResult(record._id, 'PENDING', { error: message });
            return output('PENDING', message);
        }
        // Persist the gateway outcome first. A DB failure after a transfer cannot lead to a second transfer.
        await this.repository.recordResult(record._id, result.status, result);
        if (result.status === 'SUCCEEDED') {
            await this.repository.materializeSuccess(context, { ...record, status: 'SUCCEEDED', gateway_response: result.data });
            return output('REFUNDED');
        }
        if (result.status === 'FAILED') await this.repository.releaseOrder(context.orderId, record._id);
        return output(result.status === 'FAILED' ? 'FAILED' : 'PENDING', result.error);
    }

    /**
     * Ghi nhận hoàn tiền mà người bán đã tự chuyển khoản. Chỉ cho phép khi chắc chắn cổng
     * thanh toán CHƯA chi: nếu còn một lệnh chi chưa rõ kết quả thì phải hỏi lại cổng trước,
     * không thì khách có thể nhận tiền hoàn hai lần.
     */
    async settleManually(input: RefundExecutionInput, manual: ManualSettlement): Promise<RefundExecutionResult> {
        const reference = manual.reference?.trim();
        if (!reference) throw new RefundExecutionError('Cần mã giao dịch ngân hàng của lần chuyển khoản hoàn tiền.');
        if (!input.businessKey?.trim()) throw new RefundExecutionError('Thiếu mã yêu cầu hoàn tiền đã được duyệt.');
        if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new RefundExecutionError('Số tiền hoàn phải là số nguyên VND lớn hơn 0.');
        const context = await this.repository.loadContext(input.orderId);
        if (context.simulated) throw new RefundExecutionError('Đơn mô phỏng không phát sinh hoàn tiền.', 422);
        if (context.paymentStatus !== 'PAID' && context.paymentStatus !== 'REFUNDED') throw new RefundExecutionError('Chỉ hoàn tiền cho đơn đã thanh toán.');
        input = { ...input, orderId: context.orderId };
        const record = await this.repository.findOrCreate(input);
        if (record.order_id !== context.orderId || record.amount !== input.amount) throw new RefundExecutionError('Yêu cầu hoàn tiền đã lưu có đơn hoặc số tiền khác.', 409);
        const output = (status: RefundExecutionResult['status'], error?: string): RefundExecutionResult => ({ executionId: record._id, status, amount: record.amount, ...(error ? { error } : {}) });

        if (record.status === 'SUCCEEDED') {
            await this.repository.materializeSuccess(context, record);
            return output('REFUNDED');
        }
        if (record.status === 'PROCESSING' && !isStaleProcessing(record)) throw new RefundExecutionError('Hệ thống đang gửi lệnh chi, chưa thể xác nhận hoàn tiền thủ công.', 409);
        if (record.status === 'PENDING' || record.status === 'PROCESSING') {
            let result: RefundGatewayResult;
            try { result = await this.gateway.query(context, record); }
            catch { throw new RefundExecutionError('Chưa xác minh được với cổng thanh toán là lệnh chi trước đó có thành công không. Thử lại sau để tránh hoàn tiền hai lần.', 409); }
            if (result.status === 'SUCCEEDED') {
                // Cổng đã chi thật: ghi nhận theo cổng, không cho chuyển khoản thêm.
                await this.repository.recordResult(record._id, 'SUCCEEDED', result);
                await this.repository.materializeSuccess(context, { ...record, status: 'SUCCEEDED', gateway_response: result.data });
                return output('REFUNDED');
            }
            if (result.status === 'PENDING') throw new RefundExecutionError('Cổng thanh toán vẫn đang xử lý lệnh chi trước đó. Chờ kết quả rồi mới xác nhận thủ công.', 409);
            await this.repository.recordResult(record._id, 'FAILED', result);
            await this.repository.releaseOrder(context.orderId, record._id);
        }

        if (!await this.repository.lockOrder(context.orderId, record._id)) {
            throw new RefundExecutionError('Đơn đang có một giao dịch hoàn tiền khác cần xác minh.', 409);
        }
        const refunded = await this.repository.refundedAmount(context.orderId);
        if (!Number.isSafeInteger(refunded) || input.amount > context.paidAmount - refunded) {
            await this.repository.releaseOrder(context.orderId, record._id);
            throw new RefundExecutionError('Tổng tiền hoàn vượt số tiền đã thanh toán.');
        }
        const data = { manual: true, reference, settledBy: manual.settledBy, settledAt: new Date().toISOString(), ...(manual.note ? { note: manual.note } : {}) };
        await this.repository.recordResult(record._id, 'SUCCEEDED', { status: 'SUCCEEDED', data });
        await this.repository.materializeSuccess(context, { ...record, status: 'SUCCEEDED', gateway_response: data });
        return output('REFUNDED');
    }
}

export const newRefundExecutionId = () => crypto.randomUUID();
