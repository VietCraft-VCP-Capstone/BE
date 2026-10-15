import { ReturnRequestV3, RETURN_REQUEST_V3_ACTIVE_STATUSES } from '../infrastructure/models/return-request-v3.model';
import { RefundRequest } from '../infrastructure/models/refund-request.model';

export interface ReturnQuantityUsage {
    replacedQuantity: number;
    refundedQuantity: number;
    activeReservedQuantity: number;
}

export async function getOrderItemReturnQuantityUsage(order: { _id: unknown; refund_status?: string }, orderItemId: string, orderedQuantity: number): Promise<ReturnQuantityUsage> {
    const usage = await getReturnQuantityUsage(String(order._id), orderItemId);
    if (!['REQUESTED', 'UNDER_REVIEW', 'DISPUTED', 'REFUNDED'].includes(String(order.refund_status))) return usage;
    const legacy = await RefundRequest.findOne({ order_id: order._id, status: { $in: ['PENDING_SELLER', 'SELLER_APPROVED', 'PENDING_PRINTER', 'PRINTER_APPROVED', 'DISPUTED', 'ADMIN_APPROVED', 'TIMEOUT_ESCALATED', 'REFUNDED'] } }).select('status execution_status').lean();
    if (!legacy) return usage; // A V3 refund alone must not block untouched sibling items.
    if (legacy.status === 'REFUNDED' || legacy.execution_status === 'SUCCEEDED') return { ...usage, refundedQuantity: Math.max(orderedQuantity, usage.refundedQuantity) };
    return { ...usage, activeReservedQuantity: Math.max(orderedQuantity, usage.activeReservedQuantity) };
}

/** Converted refunds remain reserved until execution succeeds; terminal consumption is counted separately. */
export async function getReturnQuantityUsage(orderId: string, orderItemId: string): Promise<ReturnQuantityUsage> {
    const rows = await ReturnRequestV3.aggregate([
        { $match: { order_id: orderId, order_item_id: orderItemId } },
        { $group: {
            _id: null,
            activeReservedQuantity: { $sum: { $cond: [{ $in: ['$status', [...RETURN_REQUEST_V3_ACTIVE_STATUSES]] }, '$quantity', 0] } },
            refundedQuantity: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'COMPLETED'] }, { $eq: [{ $ifNull: ['$final_resolution', '$requested_resolution'] }, 'REFUND'] }] }, '$quantity', 0] } },
            replacedQuantity: { $sum: { $cond: [{ $or: [{ $eq: ['$status', 'REPLACEMENT_CREATED'] }, { $and: [{ $eq: ['$status', 'COMPLETED'] }, { $eq: [{ $ifNull: ['$final_resolution', '$requested_resolution'] }, 'EXCHANGE'] }] }] }, '$quantity', 0] } },
        } },
    ]);
    const row = rows[0];
    return {
        replacedQuantity: Number(row?.replacedQuantity) || 0,
        refundedQuantity: Number(row?.refundedQuantity) || 0,
        activeReservedQuantity: Number(row?.activeReservedQuantity) || 0,
    };
}
