import { FulfillmentQueueService } from './fulfillment-queue.service';
import { logger } from '../../../shared/utils/logger';
import { config } from '../../../app/config';

export async function dispatchToPrinter(order: any): Promise<void> {
    try {
        const orderId = order._id || order.id;
        if (!orderId) {
            logger.warn('[DISPATCH TO PRINTER] Bỏ qua vì không tìm thấy order ID.');
            return;
        }
        const paidAt = order.paid_at ? new Date(order.paid_at) : new Date();
        const refundWindowEnds = new Date(paidAt.getTime() + config.refund.windowSeconds * 1000);
        await FulfillmentQueueService.enqueueOrder(orderId, refundWindowEnds);
    } catch (err: any) {
        logger.error(`[DISPATCH TO PRINTER ERROR] Không thể đưa đơn ${order?.order_code || ''} vào queue: ${err.message}`);
    }
}
