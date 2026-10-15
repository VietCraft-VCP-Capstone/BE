import { APIError, ConnectionError, ConnectionTimeoutError, PayOS, Payout } from '@payos/node';
import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';
import type { PaymentRefundRecord } from '../infrastructure/refund-execution.model';
import type { RefundContext, RefundExecutionInput, RefundGateway, RefundGatewayResult } from './refund-execution.service';

/** Phần SDK mà hoàn tiền dùng; test thay bằng bản giả qua constructor. */
export type PayosPayoutSdk = Pick<PayOS, 'payouts' | 'payoutsAccount'>;

/** payOS chưa thấy payout trong khoảng này thì chưa kết luận được là payout không tồn tại. */
const NOT_FOUND_GRACE_MS = 5 * 60 * 1000;

const text = (value: unknown) => String(value ?? '').trim();

/** payOS payout giới hạn mô tả 25 ký tự (lỗi code 20). "HT VC-1791445007611-1364" dài 24. */
const PAYOUT_DESCRIPTION_MAX = 25;
export const payoutDescription = (orderCode: string) =>
    `HT ${orderCode}`.replace(/[^A-Za-z0-9 _-]/g, '').slice(0, PAYOUT_DESCRIPTION_MAX);

export const payosPayoutReference = (record: PaymentRefundRecord) => `rf-${record.gateway_request_id}`;

/** payOS báo "Idempotency key đã tồn tại": payout có thể đã được tạo, chưa phải từ chối. */
function isDuplicateIdempotencyKey(error: unknown): boolean {
    const m = `${text((error as any)?.desc)} ${text((error as any)?.message)}`.toLowerCase();
    return m.includes('idempotency') && (m.includes('tồn tại') || m.includes('exist'));
}

/**
 * 4xx/lỗi nghiệp vụ là từ chối dứt khoát (chưa có tiền đi). Lỗi mạng, 5xx, 408, 429 và trùng
 * idempotency key là kết quả chưa biết, không được coi là thất bại để retry.
 */
function isDefinitiveRejection(error: unknown): boolean {
    if (error instanceof ConnectionError || error instanceof ConnectionTimeoutError) return false;
    const anyErr = error as any;
    if (!(error instanceof APIError) && anyErr?.code === undefined && anyErr?.desc === undefined && anyErr?.status === undefined) {
        return false;
    }
    const status = Number(anyErr.status ?? 200);
    if (!(status >= 200 && status < 500) || status === 408 || status === 429) return false;
    return !isDuplicateIdempotencyKey(error);
}

function summarize(payout: Payout) {
    const tx = payout.transactions?.[0];
    return {
        payoutId: payout.id,
        referenceId: payout.referenceId,
        approvalState: payout.approvalState,
        state: tx?.state,
        // Mã giao dịch ngân hàng, dùng làm mã đối soát hoàn tiền.
        reference: tx?.reference || payout.id,
        amount: (payout.transactions || []).reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
        errorCode: tx?.errorCode || undefined,
        errorMessage: tx?.errorMessage || undefined,
    };
}

export function classifyPayout(payout: Payout): RefundGatewayResult {
    const data = summarize(payout);
    if (data.state === 'SUCCEEDED' || payout.approvalState === 'COMPLETED') return { status: 'SUCCEEDED', data };
    if (['FAILED', 'REJECTED', 'CANCELLED'].includes(payout.approvalState) || ['FAILED', 'CANCELLED', 'REVERSED'].includes(data.state || '')) {
        return { status: 'FAILED', data, error: data.errorMessage || `payOS không thực hiện được lệnh chi (${data.errorCode || payout.approvalState}).` };
    }
    return { status: 'PENDING', data };
}

export class PayosRefundGateway implements RefundGateway {
    private client?: PayosPayoutSdk;

    constructor(client?: PayosPayoutSdk) {
        this.client = client;
    }

    configured(): boolean {
        return Boolean(config.payos.payoutClientId && config.payos.payoutApiKey && config.payos.payoutChecksumKey);
    }

    private sdk(): PayosPayoutSdk {
        if (!this.client) {
            if (!this.configured()) throw new Error('payos_payout_not_configured');
            this.client = new PayOS({
                clientId: config.payos.payoutClientId,
                apiKey: config.payos.payoutApiKey,
                checksumKey: config.payos.payoutChecksumKey,
                baseURL: config.payos.payoutBaseUrl,
                timeout: 15_000,
                maxRetries: 2,
                logLevel: 'warn',
            });
        }
        return this.client;
    }

    private async findByReference(referenceId: string): Promise<Payout | null> {
        const page = await this.sdk().payouts.list({ referenceId, limit: 10 });
        return page.data.find(item => item.referenceId === referenceId) || null;
    }

    async refund(context: RefundContext, record: PaymentRefundRecord, input: RefundExecutionInput): Promise<RefundGatewayResult> {
        const destination = context.destination;
        if (!destination) return { status: 'FAILED', data: {}, error: 'Không có tài khoản nhận hoàn tiền.' };
        if (!this.configured()) return { status: 'FAILED', data: {}, error: 'Chưa cấu hình payOS payout; tiền chưa được chuyển.' };

        const referenceId = payosPayoutReference(record);
        const request = { referenceId, amount: record.amount, toBin: destination.bin, toAccountNumber: destination.accountNo };

        // Reference gắn với lần thử này nên payout đã tồn tại chắc chắn là của refund này.
        const existing = await this.findByReference(referenceId).catch(error => {
            logger.warn(`[PayOS Refund] Không tra được reference ${referenceId} trước create: ${error?.message}`);
            return null;
        });
        if (existing) return { ...classifyPayout(existing), request };

        try {
            const balance = Number((await this.sdk().payoutsAccount.balance()).balance);
            if (Number.isFinite(balance) && balance < record.amount) {
                return { status: 'FAILED', data: {}, request, error: 'Ví payout của payOS không đủ số dư; tiền chưa được chuyển.' };
            }
        } catch (error: any) {
            // Không đọc được số dư không chứng minh payout sẽ lỗi; create vẫn là nguồn kết quả chính.
            logger.warn(`[PayOS Refund] Không kiểm tra được số dư trước ${referenceId}: ${error?.message}`);
        }

        try {
            const payout = await this.sdk().payouts.create({
                referenceId,
                amount: record.amount,
                description: payoutDescription(context.orderCode),
                toBin: destination.bin,
                toAccountNumber: destination.accountNo,
            }, referenceId);
            return { ...classifyPayout(payout), request };
        } catch (error: any) {
            // SDK tự gửi lại timeout/5xx với cùng idempotency key nên payout có thể đã tồn tại.
            // Chỉ tra theo reference mới biết chắc.
            try {
                const adopted = await this.findByReference(referenceId);
                if (adopted) return { ...classifyPayout(adopted), request };
            } catch (lookupError: any) {
                logger.warn(`[PayOS Refund] Create và lookup ${referenceId} đều lỗi: ${lookupError?.message}`);
                throw new Error('Chưa xác định được kết quả chi tiền từ payOS; yêu cầu cần được xác minh.');
            }
            if (isDefinitiveRejection(error)) {
                logger.warn(`[PayOS Refund] payOS từ chối ${referenceId}: ${error?.message}`);
                return { status: 'FAILED', data: {}, request, error: `payOS từ chối lệnh chi: ${text(error?.desc || error?.message)}` };
            }
            throw new Error('Chưa xác định được kết quả chi tiền từ payOS; yêu cầu cần được xác minh.');
        }
    }

    async query(_context: RefundContext, record: PaymentRefundRecord): Promise<RefundGatewayResult> {
        const payoutId = text(record.gateway_response?.payoutId);
        const payout = payoutId ? await this.sdk().payouts.get(payoutId) : await this.findByReference(payosPayoutReference(record));
        if (payout) return classifyPayout(payout);
        // Chưa thấy payout: trong thời gian ân hạn vẫn coi là đang chờ; quá hạn thì chưa từng có lệnh chi.
        const age = Date.now() - new Date(record.updated_at).getTime();
        return age < NOT_FOUND_GRACE_MS
            ? { status: 'PENDING', data: {} }
            : { status: 'FAILED', data: {}, error: 'payOS không có lệnh chi nào cho yêu cầu này; tiền chưa được chuyển.' };
    }
}
