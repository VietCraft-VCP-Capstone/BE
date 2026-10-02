export const REFUND_STATUSES = [
    'REQUESTED',
    'APPROVED',
    'REJECTED',
    'EXECUTING',
    'SETTLED',
    'FAILED',
    'CANCELED',
] as const;

export type RefundStatus = typeof REFUND_STATUSES[number];
export type RefundExecutor = 'PAYOS_PAYOUT' | 'MANUAL_VIETQR';

const NEXT: Record<RefundStatus, RefundStatus[]> = {
    REQUESTED: ['APPROVED', 'REJECTED'],
    APPROVED: ['EXECUTING'],
    EXECUTING: ['SETTLED', 'FAILED'],
    FAILED: ['EXECUTING', 'CANCELED'],
    REJECTED: [],
    SETTLED: [],
    CANCELED: [],
};

export function canTransition(from: RefundStatus, to: RefundStatus): boolean {
    return NEXT[from].includes(to);
}

export function assertTransition(from: RefundStatus, to: RefundStatus): void {
    if (!canTransition(from, to)) {
        throw new Error(`Chuyển trạng thái refund không hợp lệ: ${from} -> ${to}`);
    }
}

/** Refund chưa kết thúc: tiền có thể còn đang giữ hoặc đang chi, đơn chưa được sản xuất. */
export const OPEN_REFUND_STATUSES: RefundStatus[] = ['REQUESTED', 'APPROVED', 'EXECUTING', 'FAILED'];

export function isOpenRefund(status: RefundStatus): boolean {
    return OPEN_REFUND_STATUSES.includes(status);
}
