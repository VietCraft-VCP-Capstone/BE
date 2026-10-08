import assert from 'node:assert/strict';
import test from 'node:test';
import { Order } from '../infrastructure/models/order.model';
import { OrderDeliveredEventSource } from './order-delivered-event-source';

const first = new Date('2026-10-01T00:00:00Z');
const later = new Date('2026-10-02T00:00:00Z');
function fixture() {
    return { _id: 'order-1', order_status: 'DELIVERED', is_simulated: false, items: [{ order_item_id: 'item-1' }],
        status_history: [{ status: 'DELIVERED', changed_at: later }, { status: 'DELIVERED', changed_at: first }],
        printer_info: { printer_id: 'printer', supplier_order_id: 'supplier-1', printer_status: 'DELIVERED' },
        shipping_details: { carrier: 'GHN', tracking_number: 'tracking-1' } };
}
async function withOrder(order: any, run: () => Promise<void>) {
    const original = Order.findById;
    (Order as any).findById = () => ({ select: () => ({ lean: async () => order }) });
    try { await run(); } finally { Order.findById = original; }
}

test('real Delivered history enables eligibility and repeated callbacks keep the first deadline anchor', async () => {
    await withOrder(fixture(), async () => {
        const source = new OrderDeliveredEventSource();
        const event = await source.getVerifiedDeliveredEvent('order-1', 'item-1');
        assert.equal(event?.verified, true);
        assert.equal(event?.occurredAt.getTime(), first.getTime());
        assert.equal(await source.getVerifiedDeliveredEvent('order-1', 'another-item'), null);
    });
});

test('production rejects simulated delivery; explicit development mode can read it', async () => {
    await withOrder({ ...fixture(), is_simulated: true }, async () => {
        assert.equal(await new OrderDeliveredEventSource().getVerifiedDeliveredEvent('order-1', 'item-1'), null);
        assert.equal((await new OrderDeliveredEventSource(true).getVerifiedDeliveredEvent('order-1', 'item-1'))?.verified, true);
    });
});

test('a Delivered label without valid persisted history is not verified', async () => {
    await withOrder({ ...fixture(), status_history: [{ status: 'DELIVERED', changed_at: new Date('invalid') }] }, async () => {
        assert.equal(await new OrderDeliveredEventSource().getVerifiedDeliveredEvent('order-1', 'item-1'), null);
    });
});

test('R06 delivery tracking requires assigned fulfillment and carrier evidence', async () => {
    await withOrder(fixture(), async () => {
        const tracking = await new OrderDeliveredEventSource().getVerifiedTracking('order-1', 'item-1');
        assert.equal(tracking?.status, 'DELIVERED');
        assert.equal(tracking?.faultParty, 'CARRIER');
        assert.equal(tracking?.eventOccurredAt.getTime(), first.getTime());
    });
    await withOrder({ ...fixture(), printer_info: {} }, async () => {
        assert.equal(await new OrderDeliveredEventSource().getVerifiedTracking('order-1', 'item-1'), null);
    });
});

test('shipping tracking carries persisted ETA and loss must be explicitly verified', async () => {
    const order: any = { ...fixture(), order_status: 'SHIPPING', status_history: [{ status: 'SHIPPING', changed_at: first }], printer_info: { printer_id: 'printer', supplier_order_id: 'supplier-1', printer_status: 'SHIPPED', latest_eta: later } };
    await withOrder(order, async () => {
        const source = new OrderDeliveredEventSource();
        const transit = await source.getVerifiedTracking('order-1', 'item-1');
        assert.equal(transit?.status, 'IN_TRANSIT');
        assert.equal(transit?.latestEta?.getTime(), later.getTime());
        order.printer_info.tracking = { status: 'LOST', eventId: 'loss-1', eventOccurredAt: later, verified: false };
        assert.equal((await source.getVerifiedTracking('order-1', 'item-1'))?.status, 'IN_TRANSIT');
        order.printer_info.tracking.verified = true;
        assert.equal((await source.getVerifiedTracking('order-1', 'item-1'))?.status, 'LOST');
    });
});
