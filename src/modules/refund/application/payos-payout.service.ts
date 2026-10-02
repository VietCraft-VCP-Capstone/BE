import {
    APIError,
    ConnectionError,
    ConnectionTimeoutError,
    PayOS,
    Payout,
} from '@payos/node';
import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';
import { IRefund } from '../infrastructure/models/refund.model';

export type PayOSPayoutOutcome = 'PENDING' | 'SUCCESS' | 'FAILED' | 'UNKNOWN';

export interface PayOSPayoutResult {
    outcome: PayOSPayoutOutcome;
    payoutId?: string;
    referenceId: string;
    evidenceRef?: string;
    failureReason?: string;
}

/** Phần SDK mà refund dùng; test thay bằng bản giả qua `useClient`. */
export type PayoutSdk = Pick<PayOS, 'payouts' | 'payoutsAccount'>;

const NOT_FOUND_GRACE_MS = 2 * 60 * 1000;

function text(value: unknown): string {
    return String(value || '').trim();
}

/** payOS trả lời bằng tiếng Việt: "Số dư không đủ". */
function isInsufficient(code: string, message: string): boolean {
    const c = code.toUpperCase();
    const m = message.toLowerCase();
    return c.includes('BALANCE') || c.includes('INSUFFICIENT') || m.includes('số dư') || m.includes('insufficient');
}

/** payOS: "Idempotency key đã tồn tại". Các lỗi idempotency khác (thiếu, sai định dạng) là từ chối thật. */
function isDuplicateIdempotencyKey(error: unknown): boolean {
    const m = `${text((error as any)?.desc)} ${text((error as any)?.message)}`.toLowerCase();
    return m.includes('idempotency') && (m.includes('tồn tại') || m.includes('exist'));
}

function failureReason(payout: Payout): string {
    const tx = payout.transactions?.[0];
    const code = text(tx?.errorCode);
    if (isInsufficient(code, text(tx?.errorMessage))) return 'insufficient_wallet_balance';
    if (code) return `payout_rejected:${code}`;
    if (payout.approvalState === 'REJECTED') return 'payout_rejected';
    if (payout.approvalState === 'CANCELLED') return 'payout_canceled';
    return 'payout_failed';
}

function mapPayout(payout: Payout): PayOSPayoutResult {
    const transaction = payout.transactions?.[0];
    const txState = transaction?.state;
    if (txState === 'SUCCEEDED' || payout.approvalState === 'COMPLETED') {
        return {
            outcome: 'SUCCESS',
            payoutId: payout.id,
            referenceId: payout.referenceId,
            evidenceRef: transaction?.reference || payout.id,
        };
    }
    if (
        ['FAILED', 'REJECTED', 'CANCELLED'].includes(payout.approvalState)
        || ['FAILED', 'CANCELLED', 'REVERSED'].includes(txState || '')
    ) {
        return {
            outcome: 'FAILED',
            payoutId: payout.id,
            referenceId: payout.referenceId,
            failureReason: failureReason(payout),
        };
    }
    return {
        outcome: 'PENDING',
        payoutId: payout.id,
        referenceId: payout.referenceId,
    };
}

export class PayOSPayoutService {
    private client?: PayoutSdk;
    private degradedReason: string | null = null;
    private initialized = false;

    configured(): boolean {
        return Boolean(
            config.payos.payoutClientId
            && config.payos.payoutApiKey
            && config.payos.payoutChecksumKey,
        );
    }

    /** Thay SDK thật bằng client khác. Chỉ dùng cho test; không có route nào gọi tới. */
    useClient(client: PayoutSdk): void {
        this.client = client;
        this.initialized = false;
        this.degradedReason = null;
    }

    private sdk(): PayoutSdk {
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

    async initialize(): Promise<void> {
        this.initialized = true;
        if (config.refund.mode === 'MANUAL') {
            this.degradedReason = 'manual_mode_configured';
            logger.info('[PAYOS PAYOUT] Refund đang chạy MANUAL theo REFUND_MODE.');
            return;
        }
        if (config.payos.stub) {
            this.degradedReason = 'stub_payos_enabled';
            logger.warn('[PAYOS PAYOUT] STUB_PAYOS=true; tự fallback MANUAL để không giả lập chuyển tiền trên dữ liệu thật.');
            return;
        }
        if (!this.configured()) {
            this.degradedReason = 'payout_credentials_missing';
            logger.error('[PAYOS PAYOUT] Thiếu credential payout; tự fallback MANUAL_VIETQR.');
            return;
        }
        try {
            await this.getBalance();
            this.degradedReason = null;
            logger.info('[PAYOS PAYOUT] Payout channel health-check thành công.');
        } catch (error: any) {
            this.degradedReason = `payout_unavailable:${text(error?.message).slice(0, 180)}`;
            logger.error(`[PAYOS PAYOUT] Health-check thất bại; tự fallback MANUAL_VIETQR: ${error?.message}`);
        }
    }

    activeExecutor(): 'PAYOS_PAYOUT' | 'MANUAL_VIETQR' {
        if (!this.initialized) {
            // Server chỉ listen sau initialize(); nhánh này bảo vệ unit test/import trực tiếp.
            return config.refund.mode === 'PAYOUT' && this.configured() && !config.payos.stub
                ? 'PAYOS_PAYOUT'
                : 'MANUAL_VIETQR';
        }
        return config.refund.mode === 'PAYOUT' && !this.degradedReason
            ? 'PAYOS_PAYOUT'
            : 'MANUAL_VIETQR';
    }

    status() {
        return {
            configuredMode: config.refund.mode,
            activeExecutor: this.activeExecutor(),
            degraded: Boolean(this.degradedReason),
            degradedReason: this.degradedReason,
            stub: config.payos.stub,
        };
    }

    referenceFor(orderCode: string, attempt: number): string {
        const safe = orderCode.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 48);
        return attempt <= 1 ? `rf-${safe}` : `rf-${safe}-r${attempt}`;
    }

    private idempotencyKey(refund: IRefund): string {
        return `refund-${refund._id}-attempt-${refund.attempt_count}`;
    }

    async getBalance(): Promise<number> {
        const info = await this.sdk().payoutsAccount.balance();
        const balance = Number(info.balance);
        if (!Number.isFinite(balance)) throw new Error('payos_balance_invalid');
        return Math.floor(balance);
    }

    async findByReference(referenceId: string): Promise<Payout | null> {
        const page = await this.sdk().payouts.list({ referenceId, limit: 10 });
        return page.data.find(item => item.referenceId === referenceId) || null;
    }

    /**
     * Reference là duy nhất theo đơn nên payout tìm thấy chắc chắn là của refund này. Lệch số tiền
     * chỉ log: từ chối nhận nó sẽ khiến Retry tạo payout thứ hai bên cạnh một payout thật.
     */
    private adopt(payout: Payout, refund: IRefund): PayOSPayoutResult {
        const amount = (payout.transactions || []).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
        if (amount > 0 && amount !== refund.amount) {
            logger.error(
                `[PAYOS PAYOUT] Payout ${payout.id} (${payout.referenceId}) báo ${amount}₫ nhưng refund ${refund._id} là ${refund.amount}₫; kiểm tra dashboard payOS.`,
            );
        }
        return mapPayout(payout);
    }

    async execute(refund: IRefund): Promise<PayOSPayoutResult> {
        const referenceId = refund.provider_reference || this.referenceFor(refund.order_code, refund.attempt_count);
        const existing = await this.findByReference(referenceId).catch(error => {
            logger.warn(`[PAYOS PAYOUT] Không tra được reference ${referenceId} trước create: ${error.message}`);
            return null;
        });
        if (existing) return this.adopt(existing, refund);

        try {
            const balance = await this.getBalance();
            if (balance < refund.amount) {
                return { outcome: 'FAILED', referenceId, failureReason: 'insufficient_wallet_balance' };
            }
        } catch (error: any) {
            // Balance API lỗi không chứng minh payout sẽ lỗi; create vẫn là nguồn kết quả chính.
            logger.warn(`[PAYOS PAYOUT] Không kiểm tra được số dư trước ${referenceId}: ${error.message}`);
        }

        if (!refund.destination.bank_bin || !refund.destination.account_no) {
            return { outcome: 'FAILED', referenceId, failureReason: 'destination_missing' };
        }

        try {
            const payout = await this.sdk().payouts.create(
                {
                    referenceId,
                    amount: refund.amount,
                    description: `REFUND ${refund.order_code}`.replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 50),
                    toBin: refund.destination.bank_bin,
                    toAccountNumber: refund.destination.account_no,
                },
                this.idempotencyKey(refund),
            );
            return mapPayout(payout);
        } catch (error: any) {
            // SDK tự gửi lại timeout/5xx với cùng idempotency key, nên lỗi ở đây có thể đến sau
            // một lần create payOS đã nhận. Chỉ lookup theo reference mới biết payout có tồn tại.
            try {
                const adopted = await this.findByReference(referenceId);
                if (adopted) return this.adopt(adopted, refund);
            } catch (lookupError: any) {
                logger.warn(`[PAYOS PAYOUT] Create và lookup ${referenceId} đều lỗi: ${lookupError.message}`);
                return { outcome: 'UNKNOWN', referenceId, failureReason: 'payout_outcome_unknown' };
            }
            if (this.isDefinitive(error)) {
                const code = text(error?.code) || String(error?.status || 'rejected');
                const reason = isInsufficient(code, text(error?.desc || error?.message))
                    ? 'insufficient_wallet_balance'
                    : `payout_rejected:${code}`;
                logger.warn(`[PAYOS PAYOUT] payOS từ chối ${referenceId}: ${error?.message}`);
                return { outcome: 'FAILED', referenceId, failureReason: reason };
            }
            logger.warn(`[PAYOS PAYOUT] Không rõ kết quả create ${referenceId}: ${error?.message}`);
            return { outcome: 'UNKNOWN', referenceId, failureReason: 'payout_outcome_unknown' };
        }
    }

    async poll(refund: IRefund): Promise<PayOSPayoutResult> {
        const referenceId = refund.provider_reference || this.referenceFor(refund.order_code, refund.attempt_count);
        try {
            const payout = refund.provider_payout_id
                ? await this.sdk().payouts.get(refund.provider_payout_id)
                : await this.findByReference(referenceId);
            if (payout) return this.adopt(payout, refund);
            const age = Date.now() - new Date(refund.executed_at || refund.updated_at).getTime();
            return age < NOT_FOUND_GRACE_MS
                ? { outcome: 'PENDING', referenceId }
                : { outcome: 'FAILED', referenceId, failureReason: 'payout_not_found' };
        } catch (error: any) {
            return { outcome: 'UNKNOWN', referenceId, failureReason: 'payout_poll_failed' };
        }
    }

    async findLive(refund: IRefund): Promise<PayOSPayoutResult | null> {
        let pending: PayOSPayoutResult | null = null;
        for (let attempt = 1; attempt <= refund.attempt_count; attempt += 1) {
            const reference = this.referenceFor(refund.order_code, attempt);
            const payout = await this.findByReference(reference);
            if (!payout) continue;
            const result = mapPayout(payout);
            if (result.outcome === 'SUCCESS') return result;
            if (result.outcome === 'PENDING') pending = result;
        }
        return pending;
    }

    /**
     * payOS báo lỗi nghiệp vụ (vd. số dư không đủ, sai tài khoản) bằng HTTP 200 kèm code khác "00";
     * những lỗi đó và 4xx là từ chối dứt khoát. 5xx, 408, 429, lỗi kết nối và trùng idempotency key
     * thì không rõ payout đã tồn tại hay chưa, nên refund phải ở lại EXECUTING chờ reconcile.
     */
    private isDefinitive(error: unknown): boolean {
        if (error instanceof ConnectionError || error instanceof ConnectionTimeoutError) return false;
        if (!(error instanceof APIError)) return false;
        const status = Number(error.status);
        if (!(status >= 200 && status < 500) || status === 408 || status === 429) return false;
        return !isDuplicateIdempotencyKey(error);
    }
}

export const payosPayoutService = new PayOSPayoutService();
