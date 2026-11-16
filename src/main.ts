import dns from 'node:dns';
import net from 'node:net';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app from './app/app';
import { config, initializeDatabases } from './app/config';
import { logger } from './shared/utils/logger';
import { ChatGateway } from './modules/chat';
import { NotificationGateway } from './modules/notification';
import { RecommendService } from './modules/product/application/recommend/recommend.service';
// payOS (và một số cổng khác) whitelist theo IPv4. Máy có IPv6 thì Node mặc định có thể
// kết nối qua IPv6, cổng thấy địa chỉ lạ và trả 403 dù IPv4 đã được thêm. Ưu tiên IPv4.
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily(false);

// Khởi động server
async function bootstrap() {
    const server = http.createServer(app);
    const io = new SocketIOServer(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
        }
    });

    new ChatGateway(io);
    NotificationGateway.setIO(io);

    await initializeDatabases();

    const { FulfillmentQueueService } = await import('./modules/order/application/fulfillment-queue.service');
    FulfillmentQueueService.startWorker();

    const { RefundTimeoutJob } = await import('./modules/order/application/refund-timeout.job');
    RefundTimeoutJob.start();

    const { ReturnDeadlineJob } = await import('./modules/order/application/return-deadline.job');
    ReturnDeadlineJob.start();

    const { PayosPaymentReconcileJob } = await import('./modules/payment/application/payos-payment-reconcile.job');
    PayosPaymentReconcileJob.start();

    const { PayosRefundReconcileJob } = await import('./modules/payment/application/payos-refund-reconcile.job');
    PayosRefundReconcileJob.start();

    const { RollupJob } = await import('./modules/analytics/application/rollup.job');
    RollupJob.schedule();

    const { CompetitorAlertJob } = await import('./modules/analytics/application/competitor-alert.job');
    CompetitorAlertJob.schedule();
    const { AnomalyAlertJob } = await import('./modules/analytics/application/anomaly-alert.job');
    AnomalyAlertJob.schedule();

    server.listen(config.port, () => {
        logger.info(`------------------------------------------`);
        logger.info(` VietCraft Backend Monolith Running...`);
        logger.info(` Port: ${config.port} | Mode: ${config.nodeEnv}`);
        logger.info(`------------------------------------------`);
        RecommendService.warmPopular().catch(() => {});
    });
}

bootstrap().catch(err => {
    logger.error('Startup failed: ' + err.message);
});
