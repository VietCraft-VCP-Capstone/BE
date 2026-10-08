import { logger } from '../../../shared/utils/logger';
import { Order } from '../../order/infrastructure/models/order.model';
import { payosService } from './payos.service';

/** Chỉ đối soát đơn còn trong khoảng có thể vừa được trả; link payOS tự hết hạn sau 15 phút. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Đường xác nhận dự phòng khi webhook payOS không tới (URL chưa đăng ký, server tạm down,
 * BE chạy local): định kỳ hỏi payOS các đơn payOS còn PENDING. In-process; nhiều instance
 * nên chạy job ở một process riêng.
 */
export class PayosPaymentReconcileJob {
    private static timer: NodeJS.Timeout | undefined;
    private static running = false;

    static start(intervalMs = 60_000): void {
        if (this.timer || !payosService.configured()) return;
        this.timer = setInterval(() => void this.runOnce(), intervalMs);
        this.timer.unref();
    }

    static stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }

    /** Trả về số đơn vừa được ghi nhận đã thanh toán. */
    static async runOnce(now = new Date()): Promise<number> {
        if (this.running) return 0;
        this.running = true;
        let settled = 0;
        try {
            const pending = await Order.find({
                payment_method: 'PAYOS',
                payment_status: 'PENDING',
                order_status: { $ne: 'CANCELLED' },
                'payos_order_codes.0': { $exists: true },
                created_at: { $gte: new Date(now.getTime() - LOOKBACK_MS) },
            }).select('_id order_code').limit(50).lean();
            for (const order of pending) {
                try {
                    const { paymentStatus } = await payosService.syncPayment({ orderId: String(order._id) });
                    if (paymentStatus === 'PAID') settled += 1;
                } catch (error) {
                    logger.error(`[PAYOS PAYMENT RECONCILE] #${order.order_code}: ${error instanceof Error ? error.message : error}`);
                }
            }
        } catch (error) {
            logger.error(`[PAYOS PAYMENT RECONCILE] ${error instanceof Error ? error.message : error}`);
        } finally {
            this.running = false;
        }
        return settled;
    }
}
