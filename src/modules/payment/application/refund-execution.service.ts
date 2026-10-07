import crypto from 'crypto';
import type { PaymentRefundRecord, PaymentRefundStatus } from '../infrastructure/refund-execution.model';

export interface RefundContext {
    orderId: string; orderCode: string; buyerId: string; paymentMethod: string; paymentStatus: string;
    simulated: boolean; paidAmount: number; originalTransactionId: string; transactionDate: string;
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
export interface RefundExecutionResult { executionId: string; status: 'REFUNDED' | 'PENDING' | 'PROCESSING' | 'FAILED'; amount: number; error?: string }
export class RefundExecutionError extends Error {
    constructor(message: string, readonly statusCode = 400) { super(message); }
}

/** The durable record and order lock are acquired before contacting the gateway. Unknown outcomes remain reserved. */
export class RefundExecutionService {
    constructor(private readonly repository: RefundExecutionRepository, private readonly gateway: RefundGateway) {}

    async execute(input: RefundExecutionInput): Promise<RefundExecutionResult> {
        if (!input.businessKey?.trim()) throw new RefundExecutionError('Thiếu mã yêu cầu hoàn tiền đã được duyệt.');
        if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new RefundExecutionError('Số tiền hoàn phải là số nguyên VND lớn hơn 0.');
        const context = await this.repository.loadContext(input.orderId);
        if (context.simulated) throw new RefundExecutionError('Đơn mô phỏng không phát sinh hoàn tiền.', 422);
        if (context.paymentMethod !== 'VNPAY') throw new RefundExecutionError('Phương thức này chưa tích hợp hoàn tiền tự động; tiền chưa được chuyển.', 422);
        input = { ...input, orderId: context.orderId };
        const record = await this.repository.findOrCreate(input);
        if (record.order_id !== context.orderId || record.amount !== input.amount) throw new RefundExecutionError('Yêu cầu hoàn tiền đã lưu có đơn hoặc số tiền khác.', 409);
        const output = (status: RefundExecutionResult['status'], error?: string): RefundExecutionResult => ({ executionId: record._id, status, amount: record.amount, ...(error ? { error } : {}) });
        if (record.status === 'SUCCEEDED') {
            await this.repository.materializeSuccess(context, record);
            return output('REFUNDED');
        }
        if (record.status === 'PENDING') {
            // Querying is read-only at the gateway: a retry never repeats a transfer with an unknown outcome.
            let result: RefundGatewayResult;
            try { result = await this.gateway.query(context, record); }
            catch { return output('PENDING', 'Đang xác minh kết quả với cổng thanh toán.'); }
            await this.repository.recordResult(record._id, result.status, result);
            if (result.status === 'SUCCEEDED') {
                await this.repository.materializeSuccess(context, { ...record, status: 'SUCCEEDED', gateway_response: result.data });
                return output('REFUNDED');
            }
            if (result.status === 'FAILED') await this.repository.releaseOrder(context.orderId, record._id);
            return output(result.status === 'FAILED' ? 'FAILED' : 'PENDING', result.error);
        }
        if (record.status === 'PROCESSING') return output('PROCESSING');
        if (context.paymentStatus !== 'PAID') throw new RefundExecutionError('Chỉ hoàn tiền cho đơn đã thanh toán.');
        if (!context.originalTransactionId) throw new RefundExecutionError('Không tìm thấy giao dịch VNPay gốc.');
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
}

export const newRefundExecutionId = () => crypto.randomUUID();
