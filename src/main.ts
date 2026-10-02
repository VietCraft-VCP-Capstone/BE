import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app from './app/app';
import { config, initializeDatabases } from './app/config';
import { logger } from './shared/utils/logger';
import { ChatGateway } from './modules/chat';
import { NotificationGateway } from './modules/notification';
import { payosPayoutService, RefundReconcileService } from './modules/refund';

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

    // Health-check payout trước khi nhận request. Nếu credential/IP whitelist/channel
    // chưa sẵn sàng, service tự hạ xuống MANUAL_VIETQR thay vì làm refund treo.
    await payosPayoutService.initialize();
    RefundReconcileService.startWorker();

    const { FulfillmentQueueService } = await import('./modules/order/application/fulfillment-queue.service');
    FulfillmentQueueService.startWorker();

    server.listen(config.port, () => {
        logger.info(`------------------------------------------`);
        logger.info(` VietCraft Backend Monolith Running...`);
        logger.info(` Port: ${config.port} | Mode: ${config.nodeEnv}`);
        logger.info(`------------------------------------------`);
    });
}

bootstrap().catch(err => {
    logger.error('Startup failed: ' + err.message);
});
