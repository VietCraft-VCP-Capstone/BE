import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import test from 'node:test';
import { Order } from '../infrastructure/models/order.model';
import { OrderStatusSimulationDeliveredEventSource } from './order-status-simulator-delivered-event-source';

test('adapter exposes a verified Delivered event only for an enabled simulation order', async () => {
    const originalFindOne = Order.findOne;
    const simulationId = new mongoose.Types.ObjectId();
    let filter: any;
    (Order as any).findOne = (query: any) => {
        filter = query;
        return { select: () => ({ lean: async () => ({ _id: simulationId, is_simulated: true, order_status: 'DELIVERED', status_history: [{ status: 'DELIVERED', changed_at: new Date('2026-10-02T00:00:00Z') }] }) }) };
    };
    try {
        const adapter = new OrderStatusSimulationDeliveredEventSource(true);
        const event = await adapter.getVerifiedDeliveredEvent(simulationId.toString(), 'item-1');
        assert.equal(filter._id.toString(), simulationId.toString());
        assert.equal(filter.is_simulated, true);
        assert.equal(event?.verified, true);
        assert.equal(event?.eventId, `${simulationId}:DELIVERED`);
        assert.equal(await new OrderStatusSimulationDeliveredEventSource(false).getVerifiedDeliveredEvent(simulationId.toString(), 'item-1'), null);
    } finally { (Order as any).findOne = originalFindOne; }
});
