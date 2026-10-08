import { FulfillmentQueueService } from './fulfillment-queue.service';
import { logger } from '../../../shared/utils/logger';

export async function dispatchToPrinter(order: any): Promise<void> {
    try {
        const orderId = order._id || order.id;
        if (!orderId) {
            logger.warn('[DISPATCH TO PRINTER] Bỏ qua vì không tìm thấy order ID.');
            return;
        }
        await FulfillmentQueueService.enqueueOrder(orderId);
    } catch (err: any) {
        logger.error(`[DISPATCH TO PRINTER ERROR] Không thể đưa đơn ${order?.order_code || ''} vào queue: ${err.message}`);
    }
}
