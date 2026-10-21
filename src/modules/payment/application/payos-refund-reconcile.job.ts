import mongoose from 'mongoose';
import { logger } from '../../../shared/utils/logger';
import { isMongoReady } from '../../../app/config';
import { PaymentRefundExecution } from '../infrastructure/refund-execution.model';
import { Order } from '../../order/infrastructure/models/order.model';
import { PROCESSING_STALE_MS } from './refund-execution.service';

/**
 * payout payOS chốt kết quả bất đồng bộ nên hoàn tiền thường dừng ở PENDING. Job này chạy lại
 * đúng luồng nghiệp vụ đã tạo execution (yêu cầu hoàn tiền hoặc trả hàng): luồng đó sẽ tra
 * payOS (read-only), ghi Transaction REFUND và cập nhật trạng thái yêu cầu khi payout thành công.
 * In-process; nhiều instance nên chạy job ở một process riêng.
 */
export class PayosRefundReconcileJob {
    private static timer: NodeJS.Timeout | undefined;
    private static running = false;

    static start(intervalMs = 30_000): void {
        if (this.timer) return;
        this.timer = setInterval(() => void this.runOnce(), intervalMs);
        this.timer.unref();
    }

    static stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }

    /** Trả về số execution đã được chạy lại. */
    static async runOnce(minAgeMs = 10_000): Promise<number> {
        if (!isMongoReady() || this.running) return 0;
        this.running = true;
        let processed = 0;
        try {
            const pending = await PaymentRefundExecution.find({ $or: [
                { status: 'PENDING', updated_at: { $lte: new Date(Date.now() - minAgeMs) } },
                // Tiến trình chết giữa lúc gửi lệnh chi: hỏi lại cổng thay vì để kẹt.
                { status: 'PROCESSING', updated_at: { $lte: new Date(Date.now() - PROCESSING_STALE_MS) } },
            ] }).limit(50).lean();
            for (const record of pending) {
                const order = await Order.findById(record.order_id).select('payment_method').lean();
                if (order?.payment_method !== 'PAYOS') continue;
                try {
                    await this.resume(record.business_key, record);
                    processed += 1;
                } catch (error) {
                    logger.error(`[PAYOS REFUND RECONCILE] ${record.business_key}: ${error instanceof Error ? error.message : error}`);
                }
            }
            processed += await this.retryCancelledOrders();
        } catch (error) {
            logger.error(`[PAYOS REFUND RECONCILE] ${error instanceof Error ? error.message : error}`);
        } finally {
            this.running = false;
        }
        return processed;
    }

    /**
     * Đơn người mua tự hủy sau khi đã trả tiền mà hoàn tiền chưa chạy được (execution chưa được tạo vì
     * lỗi cấu hình/mạng lúc hủy, hoặc payOS từ chối lần đầu): chạy lại với cùng khóa CANCEL-<mã đơn>.
     */
    private static async retryCancelledOrders(): Promise<number> {
        const { executeRefund, cancelRefundKey } = await import('./refund-runtime');
        const { num } = await import('../../order/utils');
        const orders = await Order.find({
            order_status: 'CANCELLED', payment_method: 'PAYOS', payment_status: 'PAID', refund_status: 'REQUESTED',
            refund_execution_id: { $exists: false },
        }).limit(20).lean();
        let done = 0;
        for (const order of orders) {
            const fb = order.financial_breakdown;
            const amount = Math.round(Math.max(0, num(fb?.subtotal) + num(fb?.shipping_fee) - num(fb?.coupon_discount)));
            if (amount <= 0) continue;
            // Payout đã bị payOS từ chối dứt khoát thì không tự gửi lại mãi: để người bán/admin xử lý thủ công.
            if (await PaymentRefundExecution.exists({ business_key: cancelRefundKey(order.order_code), status: 'FAILED' })) continue;
            try {
                await executeRefund({ orderId: String(order._id), businessKey: cancelRefundKey(order.order_code), amount, reason: `Người mua tự hủy đơn #${order.order_code}`, createdBy: 'SYSTEM' });
                done += 1;
            } catch (error) {
                logger.error(`[PAYOS REFUND RECONCILE] hủy đơn ${order.order_code}: ${error instanceof Error ? error.message : error}`);
            }
        }
        return done;
    }

    private static async resume(businessKey: string, record: { order_id: string; amount: number }): Promise<void> {
        // Hoàn tiền do người mua tự hủy đơn: khóa là "CANCEL-<mã đơn>-<ts>", không có yêu cầu nghiệp vụ
        // nào để tra. Chạy lại đúng execution đã lưu (cùng đơn, cùng số tiền): execute() chỉ hỏi lại cổng.
        if (businessKey.startsWith('CANCEL-')) {
            const { executeRefund } = await import('./refund-runtime');
            await executeRefund({ orderId: record.order_id, businessKey, amount: record.amount, reason: 'Hoàn tiền hủy đơn (đối soát)', createdBy: 'SYSTEM' });
            return;
        }
        // Import muộn để tránh vòng phụ thuộc payment <-> order.
        const { Types } = await import('mongoose');
        if (Types.ObjectId.isValid(businessKey)) {
            const { RefundRequest } = await import('../../order/infrastructure/models/refund-request.model');
            if (await RefundRequest.exists({ _id: businessKey })) {
                const { RefundRequestService } = await import('../../order/application/refund-request.service');
                await RefundRequestService.retryExecution(businessKey, 'SYSTEM');
                return;
            }
        }
        const { MongoReturnRequestRepository } = await import('../../order/infrastructure/repositories/return-request.repository');
        const request = await new MongoReturnRequestRepository().findById(businessKey);
        if (request) {
            const { executeReturnRefund } = await import('../../order/application/return-refund-executor');
            await executeReturnRefund(request);
            return;
        }
        if (businessKey.startsWith('CANCEL-')) {
            const { refundExecutionService } = await import('./refund-runtime');
            const execution = await PaymentRefundExecution.findOne({ business_key: businessKey }).lean();
            if (execution) {
                await refundExecutionService.execute({
                    orderId: execution.order_id,
                    businessKey: execution.business_key,
                    amount: execution.amount,
                    reason: 'Hủy đơn hàng',
                    createdBy: 'SYSTEM',
                });
                return;
            }
        }
        logger.warn(`[PAYOS REFUND RECONCILE] Không tìm thấy yêu cầu nghiệp vụ cho execution ${businessKey}.`);
    }
}
