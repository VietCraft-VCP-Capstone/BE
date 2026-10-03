import type { DeliveredEventSource, VerifiedDeliveredEvent } from './return-policy';
import { Order } from '../infrastructure/models/order.model';

/** Development adapter for Return v3. Return policy depends only on DeliveredEventSource, never this simulator. */
export class OrderStatusSimulationDeliveredEventSource implements DeliveredEventSource {
    constructor(private readonly enabled: boolean) {}

    async getVerifiedDeliveredEvent(orderId: string, _orderItemId: string): Promise<VerifiedDeliveredEvent | null> {
        if (!this.enabled) return null;
        const order = await Order.findOne({ _id: orderId, is_simulated: true })
            .select('_id order_status status_history')
            .lean();
        if (!order || order.order_status !== 'DELIVERED') return null;
        const delivered = [...(order.status_history ?? [])].reverse().find(event => event.status === 'DELIVERED' && event.changed_at instanceof Date);
        if (!delivered?.changed_at) return null;
        return { eventId: `${String(order._id)}:DELIVERED`, occurredAt: delivered.changed_at, verified: true };
    }
}
