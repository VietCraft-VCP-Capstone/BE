import crypto from 'crypto';
import { config } from '../../../app/config';
import { formatVnpayDate, createHmacSha512 } from '../utils/vnpay.util';
import type { PaymentRefundRecord } from '../infrastructure/refund-execution.model';
import type { RefundContext, RefundExecutionInput, RefundGateway, RefundGatewayResult } from './refund-execution.service';

const responseFields = ['vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo'];
/** VNPAY 2.1.0: https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr%26refund.html */
export function verifyRefundResponse(data: Record<string, any>, secret: string, query = false): boolean {
    const fields = query ? [...responseFields, 'vnp_PromotionCode', 'vnp_PromotionAmount'] : responseFields;
    const expected = createHmacSha512(secret, fields.map(key => String(data[key] ?? '')).join('|'));
    const supplied = String(data.vnp_SecureHash || '').toLowerCase();
    return /^[a-f0-9]{128}$/.test(supplied) && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}
export function classifyRefundResponse(data: Record<string, any>, context: RefundContext, record: PaymentRefundRecord, query = false): RefundGatewayResult {
    if (String(data.vnp_TmnCode) !== config.vnpay.tmnCode || String(data.vnp_TxnRef) !== context.orderCode) throw new Error('Phản hồi gateway không khớp đơn hàng.');
    if (data.vnp_ResponseCode !== '00') {
        // A query rejection cannot prove that the earlier transfer failed.
        const knownFailure = !query && ['02', '03', '91', '95', '97'].includes(String(data.vnp_ResponseCode));
        return { status: knownFailure ? 'FAILED' : 'PENDING', data, error: String(data.vnp_Message || 'Cổng thanh toán đang xác minh yêu cầu.') };
    }
    if (!['02', '03'].includes(String(data.vnp_TransactionType)) || Number(data.vnp_Amount) !== record.amount * 100) return { status: 'PENDING', data, error: 'Chưa có kết quả khớp giao dịch hoàn tiền.' };
    if (query) {
        const knownTransaction = record.gateway_response?.vnp_TransactionNo;
        if (knownTransaction && String(data.vnp_TransactionNo) !== String(knownTransaction)) return { status: 'PENDING', data };
        if (!knownTransaction && (!/^\d{14}$/.test(String(data.vnp_PayDate)) || String(data.vnp_PayDate) < formatVnpayDate(record.updated_at))) return { status: 'PENDING', data };
    }
    return { status: data.vnp_TransactionStatus === '00' ? 'SUCCEEDED' : ['02', '09'].includes(String(data.vnp_TransactionStatus)) ? 'FAILED' : 'PENDING', data, ...(data.vnp_TransactionStatus === '09' ? { error: 'Ngân hàng từ chối hoàn tiền.' } : {}) };
}

export class VNPayRefundGateway implements RefundGateway {
    constructor(private readonly request: typeof fetch = fetch) {}
    private async send(body: Record<string, any>, context: RefundContext, record: PaymentRefundRecord, query = false): Promise<RefundGatewayResult> {
        const response = await this.request(config.vnpay.apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('Cổng thanh toán chưa trả kết quả; yêu cầu cần được xác minh.');
        const data = await response.json() as Record<string, any>;
        if (!verifyRefundResponse(data, config.vnpay.hashSecret, query)) throw new Error('Chữ ký phản hồi VNPay không hợp lệ; chưa xác nhận tiền đã hoàn.');
        return { ...classifyRefundResponse(data, context, record, query), request: body };
    }
    async refund(context: RefundContext, record: PaymentRefundRecord, input: RefundExecutionInput): Promise<RefundGatewayResult> {
        const body: Record<string, any> = { vnp_RequestId: record.gateway_request_id, vnp_Version: '2.1.0', vnp_Command: 'refund', vnp_TmnCode: config.vnpay.tmnCode, vnp_TransactionType: record.amount === context.paidAmount ? '02' : '03', vnp_TxnRef: context.orderCode, vnp_Amount: record.amount * 100, vnp_TransactionNo: context.originalTransactionId, vnp_TransactionDate: context.transactionDate, vnp_CreateBy: input.createdBy || 'VietCraft', vnp_CreateDate: formatVnpayDate(), vnp_IpAddr: input.clientIp || '127.0.0.1', vnp_OrderInfo: input.reason };
        body.vnp_SecureHash = createHmacSha512(config.vnpay.hashSecret, ['vnp_RequestId','vnp_Version','vnp_Command','vnp_TmnCode','vnp_TransactionType','vnp_TxnRef','vnp_Amount','vnp_TransactionNo','vnp_TransactionDate','vnp_CreateBy','vnp_CreateDate','vnp_IpAddr','vnp_OrderInfo'].map(key => body[key]).join('|'));
        return this.send(body, context, record);
    }
    async query(context: RefundContext, record: PaymentRefundRecord): Promise<RefundGatewayResult> {
        const body: Record<string, any> = { vnp_RequestId: crypto.randomBytes(16).toString('hex'), vnp_Version: '2.1.0', vnp_Command: 'querydr', vnp_TmnCode: config.vnpay.tmnCode, vnp_TxnRef: context.orderCode, vnp_TransactionDate: context.transactionDate, vnp_CreateDate: formatVnpayDate(), vnp_IpAddr: '127.0.0.1', vnp_OrderInfo: `Kiem tra hoan tien ${record.gateway_request_id}`, ...(record.gateway_response?.vnp_TransactionNo ? { vnp_TransactionNo: record.gateway_response.vnp_TransactionNo } : {}) };
        body.vnp_SecureHash = createHmacSha512(config.vnpay.hashSecret, ['vnp_RequestId','vnp_Version','vnp_Command','vnp_TmnCode','vnp_TxnRef','vnp_TransactionDate','vnp_CreateDate','vnp_IpAddr','vnp_OrderInfo'].map(key => body[key]).join('|'));
        return this.send(body, context, record, true);
    }
}
