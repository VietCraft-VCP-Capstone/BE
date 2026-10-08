import { logger } from '../../../shared/utils/logger';
import { PaymentRefundExecution } from '../infrastructure/refund-execution.model';
import { Order } from '../../order/infrastructure/models/order.model';
import { PROCESSING_STALE_MS } from './refund-execution.service';

/**
 * payout payOS chốt kết quả bất đồng bộ nên hoàn tiền thường dừng ở PENDING. Job này chạy lại
 * đúng luồng nghiệp vụ đã tạo execution (yêu cầu hoàn tiền hoặc trả hàng v3): luồng đó sẽ tra
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
        if (this.running) return 0;
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
                    await this.resume(record.business_key);
                    processed += 1;
                } catch (error) {
                    logger.error(`[PAYOS REFUND RECONCILE] ${record.business_key}: ${error instanceof Error ? error.message : error}`);
                }
            }
        } catch (error) {
            logger.error(`[PAYOS REFUND RECONCILE] ${error instanceof Error ? error.message : error}`);
        } finally {
            this.running = false;
        }
        return processed;
    }

    private static async resume(businessKey: string): Promise<void> {
        // Import muộn để tránh vòng phụ thuộc payment <-> order.
        const { RefundRequest } = await import('../../order/infrastructure/models/refund-request.model');
        if (await RefundRequest.exists({ _id: businessKey })) {
            const { RefundRequestService } = await import('../../order/application/refund-request.service');
            await RefundRequestService.retryExecution(businessKey, 'SYSTEM');
            return;
        }
        const { MongoReturnRequestV3Repository } = await import('../../order/infrastructure/repositories/return-request-v3.repository');
        const request = await new MongoReturnRequestV3Repository().findById(businessKey);
        if (request) {
            const { executeReturnRefund } = await import('../../order/application/return-refund-executor');
            await executeReturnRefund(request);
            return;
        }
        logger.warn(`[PAYOS REFUND RECONCILE] Không tìm thấy yêu cầu nghiệp vụ cho execution ${businessKey}.`);
    }
}
