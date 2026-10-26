import { Order } from '../../../order/infrastructure/models/order.model';
import { Cart } from '../../../cart/infrastructure/models/cart.model';
import { ProductEvent } from '../../../analytics/infrastructure/models/product-event.model';
import { toOid } from './user-signals';

export function buildVersion(cartAt?: Date | null, orderId?: unknown, eventAt?: Date | null): string {
    return `${cartAt?.getTime() ?? 0}-${orderId ?? 0}-${eventAt?.getTime() ?? 0}`;
}

/** Trả version + product_id trong giỏ và đơn mới nhất (để lọc khỏi gợi ý ngay, không chờ cache). */
export async function signalVersion(userId?: string, sessionId?: string): Promise<{ version: string; hide: Set<string> }> {
    const uid = toOid(userId);
    const owner = uid ? { user_id: uid } : sessionId ? { session_id: sessionId } : null;
    if (!owner) return { version: '0', hide: new Set() };
    const [cart, order, event] = await Promise.all([
        uid ? Cart.findOne({ user_id: uid }).select('updated_at items.product_id').lean() : null,
        uid ? Order.findOne({ buyer_id: uid }).sort({ created_at: -1 }).select('_id items.product_id').lean() : null,
        ProductEvent.findOne(owner).sort({ created_at: -1 }).select('created_at').lean(),
    ]) as [any, any, any];
    const hide = new Set<string>([...(cart?.items ?? []), ...(order?.items ?? [])].map((i: any) => String(i.product_id)));
    return { version: buildVersion(cart?.updated_at, order?._id, event?.created_at), hide };
}
