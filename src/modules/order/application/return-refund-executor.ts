import { executeVnpayRefund } from '../../payment/application/refund-runtime';
import { ReturnRefundExecution } from '../infrastructure/models/return-refund-execution.model';
import { ReturnRequest } from '../infrastructure/models/return-request.model';
import type { ReturnRequestData } from '../infrastructure/repositories/return-request.repository';
import type { ReturnRefundExecutionStatus } from '../infrastructure/models/return-refund-execution.model';

/** Uses the saved Admin decision; request-body amounts can never change an execution. */
export async function executeReturnRefund(request: ReturnRequestData): Promise<{ id: string; status: ReturnRefundExecutionStatus }> {
    const linked = await ReturnRefundExecution.findOne({ request_id: request.id, order_item_id: request.order_item_id }).lean();
    if (!linked || !request.refund_admin_confirmed || linked.admin_decision_id !== request.admin_decision_id) throw new Error('Không tìm thấy quyết định hoàn tiền đã được Admin xác nhận.');
    if (linked.status === 'REFUNDED') return { id: String(linked._id), status: 'REFUNDED' };
    if (linked.currency !== 'VND' || linked.amount_minor <= 0) throw new Error('Chỉ thực thi số tiền VND nguyên lớn hơn 0.');
    let status: ReturnRefundExecutionStatus;
    let error = '';
    try {
        const result = await executeVnpayRefund({ orderId: request.order_id, businessKey: request.id, amount: linked.amount_minor,
            reason: `Hoan tien mon hang ${request.order_item_id}`, createdBy: request.refund_admin_confirmed_by || 'VietCraft' });
        status = result.status;
        error = result.error || '';
    } catch (cause) {
        status = (cause as { statusCode?: number }).statusCode === 422 ? 'PENDING_INTEGRATION' : 'FAILED';
        error = cause instanceof Error ? cause.message : 'Chưa xác nhận chuyển tiền.';
    }
    await ReturnRefundExecution.updateOne({ _id: linked._id, status: { $ne: 'REFUNDED' } }, { $set: { status, error } }, { runValidators: true });
    await ReturnRequest.updateOne({ _id: request.id, status: { $ne: 'COMPLETED' } }, { $set: { linked_refund_status: status }, $inc: { version: 1 } });
    return { id: String(linked._id), status };
}
