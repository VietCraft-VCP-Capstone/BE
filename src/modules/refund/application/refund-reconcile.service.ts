import { logger } from '../../../shared/utils/logger';
import { RefundService } from './refund.service';

export class RefundReconcileService {
    private static timer: NodeJS.Timeout | null = null;

    static startWorker(intervalMs = 30_000): void {
        if (this.timer) return;
        logger.info(`[PAYOS PAYOUT] Reconcile worker chạy mỗi ${intervalMs / 1000}s.`);
        this.timer = setInterval(() => {
            RefundService.reconcilePendingPayOS().catch(error => {
                logger.error(`[PAYOS PAYOUT] Reconcile worker lỗi: ${error.message}`);
            });
        }, intervalMs);
        this.timer.unref();
    }

    static stopWorker(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}
