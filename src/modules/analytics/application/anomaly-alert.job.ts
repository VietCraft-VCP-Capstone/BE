import { logger } from '../../../shared/utils/logger';
import { AiGatewayService } from './ai-gateway.service';
import { AnomalyEvent } from './anomaly-alert.message';
import { deliverAlert } from './anomaly-alert.delivery';

const RUN_TIMEOUT_MS = 120000;
const BOOT_DELAY_MS = 2 * 60 * 1000;

export class AnomalyAlertJob {
    private static isRunning = false;

    static async run(): Promise<Record<string, number>> {
        if (this.isRunning) {
            logger.warn('Anomaly alert job is already running, skipping');
            return {};
        }

        this.isRunning = true;
        const counts: Record<string, number> = {};
        try {
            const res = await AiGatewayService.call({
                method: 'POST',
                path: '/api/internal/f30/run',
                shopId: 'internal',
                body: { backfill_days: 0 },
                timeoutMs: RUN_TIMEOUT_MS,
            });
            if (res.status !== 200) {
                logger.error(`Anomaly alert job: AI trả HTTP ${res.status}`);
                return {};
            }

            for (const event of (res.body?.data?.events ?? []) as AnomalyEvent[]) {
                try {
                    const result = await deliverAlert(event);
                    counts[result] = (counts[result] ?? 0) + 1;
                } catch (error) {
                    counts.error = (counts.error ?? 0) + 1;
                    logger.error(`Anomaly alert delivery failed: ${error}`);
                }
            }
            logger.info(`Anomaly alert job completed: ${JSON.stringify(counts)}`);
            return counts;
        } finally {
            this.isRunning = false;
        }
    }

    static schedule(): void {
        setTimeout(() => {
            this.run().catch(error => logger.error(`Anomaly alert job failed: ${error}`));
        }, BOOT_DELAY_MS);

        const scheduleNextRun = () => {
            const now = new Date();
            const next = new Date(now);
            next.setUTCHours(0, 30, 0, 0);
            if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

            setTimeout(async () => {
                await this.run().catch(error => logger.error(`Scheduled anomaly alert job failed: ${error}`));
                scheduleNextRun();
            }, next.getTime() - now.getTime());
        };

        scheduleNextRun();
    }
}
