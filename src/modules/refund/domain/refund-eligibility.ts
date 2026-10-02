import { RefundStatus } from './refund-state';

export type RefundBlockedReason =
    | 'already_refunded'
    | 'not_paid'
    | 'order_canceled'
    | 'refund_in_progress'
    | 'refund_canceled'
    | 'payment_time_missing'
    | 'window_closed';

export interface RefundEligibilityInput {
    paymentStatus?: string | null;
    orderStatus?: string | null;
    paidAt?: Date | null;
    existingRefundStatus?: RefundStatus | null;
    now: Date;
    windowSeconds: number;
}

export function refundableUntil(paidAt: Date | null | undefined, windowSeconds: number): Date | null {
    return paidAt ? new Date(paidAt.getTime() + windowSeconds * 1000) : null;
}

/** Mỗi đơn chỉ có một refund; refund đã có quyết định đơn đó còn tạo được refund nữa không. */
export function existingRefundReason(status?: RefundStatus | null): RefundBlockedReason | null {
    switch (status) {
        case null:
        case undefined:
            return null;
        case 'SETTLED':
            return 'already_refunded';
        case 'REJECTED':
        case 'CANCELED':
            return 'refund_canceled';
        default:
            return 'refund_in_progress';
    }
}

/**
 * Lý do chặn tạo refund, lỗi đầu tiên thắng. Dùng chung cho POST /refunds và API eligibility
 * để nút "Hoàn tiền" trên FE và quyết định của server không bao giờ lệch nhau.
 * Kết quả của refund đã có được báo trước window, vì đơn đó đằng nào cũng không tạo thêm được.
 */
export function refundBlockedReason(input: RefundEligibilityInput): RefundBlockedReason | null {
    if (input.paymentStatus === 'REFUNDED') return 'already_refunded';
    if (input.paymentStatus !== 'PAID') return 'not_paid';
    if (input.orderStatus === 'CANCELLED') return 'order_canceled';

    const existing = existingRefundReason(input.existingRefundStatus);
    if (existing) return existing;

    const until = refundableUntil(input.paidAt, input.windowSeconds);
    if (!until) return 'payment_time_missing';
    // Window chỉ chặn việc TẠO refund. Refund tạo ở giây 299 vẫn được thực thi tiếp sau đó.
    if (input.now.getTime() > until.getTime()) return 'window_closed';
    return null;
}
