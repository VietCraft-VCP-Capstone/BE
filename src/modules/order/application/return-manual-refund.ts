import { refundContextOf, settleRefundManually } from '../../payment/application/refund-runtime';
import { PaymentRefundExecution } from '../../payment/infrastructure/refund-execution.model';
import { ReturnRefundExecution } from '../infrastructure/models/return-refund-execution.model';
import { ReturnRequest, ReturnRequestLog } from '../infrastructure/models/return-request.model';

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export const cappedRefund = (decided: number, paid: number) => Number.isSafeInteger(paid) && paid > 0 ? Math.min(decided, paid) : decided;

export async function payableReturnRefund(orderId: string, decided: number) {
    try { return cappedRefund(decided, (await refundContextOf(orderId)).paidAmount); } catch { return decided; }
}

/** Quyết định cũ có thể vượt số tiền khách đã trả: chỉ hạ xuống, và chỉ khi tiền chưa được chi. */
async function capToPaid(request: any, linked: any, adminId: string): Promise<number> {
    const paid = (await refundContextOf(request.order_id)).paidAmount;
    if (cappedRefund(linked.amount_minor, paid) === linked.amount_minor) return linked.amount_minor;
    const pay = await PaymentRefundExecution.findOne({ business_key: request._id }).lean();
    if (pay && pay.status !== 'READY' && pay.status !== 'FAILED') throw fail('Lệnh hoàn đang được xử lý, chưa thể điều chỉnh số tiền.', 409);
    await PaymentRefundExecution.updateOne({ business_key: request._id, status: { $in: ['READY', 'FAILED'] } }, { $set: { amount: paid } });
    await ReturnRefundExecution.updateOne({ _id: linked._id }, { $set: { amount_minor: paid } });
    await ReturnRequest.updateOne({ _id: request._id }, { $set: { refund_amount_minor: paid } });
    await ReturnRequestLog.create({ request_id: request._id, actor_id: adminId, actor_role: 'ADMIN', from_status: request.status, to_status: request.status,
        reason: `Số tiền hoàn điều chỉnh từ ${linked.amount_minor.toLocaleString('vi-VN')}đ xuống ${paid.toLocaleString('vi-VN')}đ (số tiền khách đã thanh toán).` });
    return paid;
}

/** Admin đã tự chuyển khoản hoàn cho khách (đơn COD): ghi nhận bằng mã giao dịch, mỗi mã dùng một lần. */
export async function settleReturnRefundManually(requestId: string, adminId: string, reference: string, note?: string) {
    const request: any = await ReturnRequest.findById(requestId).lean();
    if (!request) throw fail('Không tìm thấy yêu cầu đổi/trả.', 404);
    const linked = await ReturnRefundExecution.findOne({ request_id: request._id, order_item_id: request.order_item_id }).lean();
    if (!linked || !request.refund_admin_confirmed || linked.admin_decision_id !== request.admin_decision_id) throw fail('Yêu cầu chưa có quyết định hoàn tiền đã được Admin xác nhận.');
    if (linked.status === 'REFUNDED') return { id: String(linked._id), status: 'REFUNDED' as const };
    if (linked.status !== 'PENDING_INTEGRATION' && linked.status !== 'FAILED') throw fail('Lệnh hoàn đang được xử lý tự động, chưa thể xác nhận thủ công.', 409);
    const amount = await capToPaid(request, linked, adminId);
    const result = await settleRefundManually(
        { orderId: request.order_id, businessKey: request._id, amount, reason: `Hoan tien mon hang ${request.order_item_id}`, createdBy: adminId },
        { reference, settledBy: adminId, ...(note?.trim() ? { note: note.trim() } : {}) },
    );
    await ReturnRefundExecution.updateOne({ _id: linked._id }, { $set: { status: 'REFUNDED', error: '' } });
    await ReturnRequest.updateOne({ _id: request._id }, { $set: { linked_refund_status: 'REFUNDED', updated_at: new Date() }, $inc: { version: 1 } });
    await ReturnRequestLog.create({ request_id: request._id, actor_id: adminId, actor_role: 'ADMIN', from_status: request.status, to_status: request.status,
        reason: `Đã chuyển khoản hoàn ${amount.toLocaleString('vi-VN')}đ cho bạn.`, event_id: result.executionId });
    return { id: String(linked._id), status: 'REFUNDED' as const };
}
