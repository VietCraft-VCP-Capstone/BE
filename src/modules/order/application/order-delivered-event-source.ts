import { Order } from '../infrastructure/models/order.model';
import type { ReturnDeliveredEventSource } from './return-request.service';
import type { R06TrackingEvidence, VerifiedDeliveredEvent } from './return-policy';

function validDate(value: unknown): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime());
}

/** Reads delivery history written by authenticated fulfillment or buyer confirmation handlers. */
export class OrderDeliveredEventSource implements ReturnDeliveredEventSource {
    constructor(private readonly allowSimulated = false) {}

    private async getOrder(orderId: string, itemId: string): Promise<any | null> {
        const order = await Order.findById(orderId).select('_id is_simulated order_status items status_history printer_info supplier_order_id shipping_details').lean();
        if (!order || (!this.allowSimulated && order.is_simulated === true)) return null;
        return (order.items || []).some((item: any) => String(item.order_item_id || item._id || '') === itemId) ? order : null;
    }

    private deliveredEvent(order: any): VerifiedDeliveredEvent | null {
        if (order.order_status !== 'DELIVERED') return null;
        // The first delivery anchors the deadline; duplicate callbacks must not extend it.
        const delivered = (order.status_history || []).filter((row: any) => row.status === 'DELIVERED' && validDate(row.changed_at))
            .sort((a: any, b: any) => a.changed_at.getTime() - b.changed_at.getTime())[0];
        if (!delivered) return null;
        return { eventId: `${String(order._id)}:DELIVERED:${delivered.changed_at.toISOString()}`, occurredAt: delivered.changed_at, verified: true };
    }

    async getVerifiedDeliveredEvent(orderId: string, itemId: string): Promise<VerifiedDeliveredEvent | null> {
        const order = await this.getOrder(orderId, itemId);
        return order ? this.deliveredEvent(order) : null;
    }

    async getVerifiedTracking(orderId: string, itemId: string): Promise<(R06TrackingEvidence & { faultParty?: 'CARRIER' | 'PRINTER' }) | null> {
        const order = await this.getOrder(orderId, itemId);
        if (!order) return null;
        const info = order.printer_info || {};
        const assigned = !!info.printer_id && !!(info.supplier_order_id || order.supplier_order_id);
        const shipping = order.shipping_details || {};
        if (!assigned || !shipping.tracking_number || !shipping.carrier) return null;
        const delivered = this.deliveredEvent(order);
        if (delivered) return { status: 'DELIVERED', eventId: delivered.eventId, eventOccurredAt: delivered.occurredAt, sourceAssigned: true, verified: true, faultParty: 'CARRIER' };
        // Loss/return events need explicitly verified persisted tracking, never a client-supplied reason.
        const tracking = info.tracking;
        if (tracking?.verified === true && ['LOST', 'RETURNED'].includes(tracking.status) && typeof tracking.eventId === 'string' && tracking.eventId.trim()) {
            const at = tracking.eventOccurredAt instanceof Date ? tracking.eventOccurredAt : new Date(tracking.eventOccurredAt);
            if (validDate(at)) return { status: tracking.status, eventId: tracking.eventId, eventOccurredAt: at, sourceAssigned: true, verified: true, faultParty: 'CARRIER' };
        }
        if (order.order_status !== 'SHIPPING' || !['SHIPPED', 'SHIPPING', 'IN_TRANSIT'].includes(String(info.printer_status).toUpperCase())) return null;
        const shipped = (order.status_history || []).filter((row: any) => row.status === 'SHIPPING' && validDate(row.changed_at))
            .sort((a: any, b: any) => b.changed_at.getTime() - a.changed_at.getTime())[0];
        if (!shipped) return null;
        const etaValue = tracking?.latestEta || info.latest_eta;
        const eta = etaValue ? new Date(etaValue) : null;
        return { status: 'IN_TRANSIT', eventId: `${String(order._id)}:SHIPPING:${shipped.changed_at.toISOString()}`, eventOccurredAt: shipped.changed_at, sourceAssigned: true, verified: true, faultParty: 'CARRIER', latestEta: eta && validDate(eta) ? eta : null };
    }
}
