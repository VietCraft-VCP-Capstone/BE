import { ReturnRequest, RETURN_REQUEST_ACTIVE_STATUSES } from '../../order/infrastructure/models/return-request.model';
import { R06_DELIVERED_WINDOW_HOURS } from '../../order/application/return-policy';

export type SettlementStatus = 'SETTLED' | 'PENDING' | 'CANCELLED' | 'REFUNDED';

// Giữ tiền bằng hạn đổi trả dài nhất (168h) để seller không rút tiền của đơn còn có thể bị hoàn.
export const SETTLEMENT_HOLD_MS = R06_DELIVERED_WINDOW_HOURS * 60 * 60 * 1000;
const OPEN_LEGACY_REFUND = ['REQUESTED', 'UNDER_REVIEW', 'DISPUTED'];

export async function openReturnOrderIds(sellerUserId: string): Promise<Set<string>> {
    const ids = await ReturnRequest.distinct('order_id', { seller_id: sellerUserId, status: { $in: [...RETURN_REQUEST_ACTIVE_STATUSES] } });
    return new Set(ids.map(String));
}

export function deliveredAt(order: any): Date | null {
    const hist = (order.status_history || []).filter((h: any) => h.status === 'DELIVERED');
    const at = hist.length ? hist[hist.length - 1].changed_at : order.updated_at;
    return at ? new Date(at) : null;
}

export function settlementStatusOf(order: any, openOrderIds: Set<string>, now = new Date()): SettlementStatus {
    if (order.order_status === 'CANCELLED') return 'CANCELLED';
    if (order.payment_status === 'REFUNDED' || order.refund_status === 'REFUNDED') return 'REFUNDED';
    if (order.order_status !== 'DELIVERED') return 'PENDING';
    if (openOrderIds.has(String(order._id)) || OPEN_LEGACY_REFUND.includes(order.refund_status)) return 'PENDING';
    const at = deliveredAt(order);
    return at && now.getTime() - at.getTime() >= SETTLEMENT_HOLD_MS ? 'SETTLED' : 'PENDING';
}
