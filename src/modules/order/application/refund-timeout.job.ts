import { logger } from '../../../shared/utils/logger';
import { RefundRequestService } from './refund-request.service';

/** In-process fallback scheduler. Multi-instance deployments should run this worker in one dedicated process. */
export class RefundTimeoutJob {
    private static timer: NodeJS.Timeout | undefined;

    static start(intervalMs = 60_000): void {
        if (this.timer) return;
        this.timer = setInterval(() => {
            void RefundRequestService.timeoutExpired().catch(error => logger.error(`[REFUND TIMEOUT] ${error.message}`));
        }, intervalMs);
        this.timer.unref();
        void RefundRequestService.timeoutExpired().catch(error => logger.error(`[REFUND TIMEOUT] ${error.message}`));
    }

    static stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }
}
