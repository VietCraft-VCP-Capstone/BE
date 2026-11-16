import mongoose from 'mongoose';
import { Order } from '../../../order/infrastructure/models/order.model';
import { ProductEvent } from '../../../analytics/infrastructure/models/product-event.model';
import { SearchLog } from '../../../analytics/infrastructure/models/search-log.model';
import { Cart } from '../../../cart/infrastructure/models/cart.model';
import { Wishlist } from '../../infrastructure/models/wishlist.model';
import { ShopFollower } from '../../infrastructure/models/shop-follower.model';
import { Shop } from '../../infrastructure/models/shop.model';
import { nfcLower } from '../../../../shared/utils/vietnamese-search.util';
import { WEIGHTS, VIEW_CAP, WINDOW_DAYS, decayWeight } from './user-profile';

export interface SignalItem {
    productId: string;
    weight: number;
}

export interface UserSignals {
    items: SignalItem[];
    keywords: string[];
    followedShopIds: string[];
    ownShopIds: mongoose.Types.ObjectId[];
    excluded: mongoose.Types.ObjectId[];
}

export interface SignalParams {
    userId?: string;
    sessionId?: string;
    q: string[];
}

const RECENT_KEYWORDS = 5;
const MAX_KEYWORDS = 8;
const DAY_MS = 86400000;

export function toOid(id?: string): mongoose.Types.ObjectId | undefined {
    return id && mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : undefined;
}

/** Đọc các nguồn tín hiệu (chỉ đọc, không ghi log). Khách đăng nhập dùng user_id, vãng lai dùng session_id. */
export async function loadSignals(p: SignalParams): Promise<UserSignals> {
    const uid = toOid(p.userId);
    const owner = uid ? { user_id: uid } : p.sessionId ? { session_id: p.sessionId } : null;
    const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS);
    const [orders, events, logs, recent, cart, wish, follows, own] = await Promise.all([
        uid ? Order.find({ buyer_id: uid, order_status: { $ne: 'CANCELLED' }, refund_status: { $ne: 'REFUNDED' } })
            .select('items.product_id created_at').lean() : [],
        owner ? ProductEvent.find({ ...owner, created_at: { $gte: since } })
            .select('product_id event_type created_at').sort({ created_at: -1 }).limit(500).lean() : [],
        uid ? SearchLog.find({ user_id: uid, created_at: { $gte: since }, 'clicks.0': { $exists: true } })
            .select('clicks created_at').sort({ created_at: -1 }).limit(50).lean() : [],
        uid ? SearchLog.find({ user_id: uid, result_count: { $gt: 0 } })
            .select('keyword').sort({ created_at: -1 }).limit(RECENT_KEYWORDS).lean() : [],
        uid ? Cart.findOne({ user_id: uid }).select('items.product_id').lean() : null,
        uid ? Wishlist.findOne({ user_id: uid }).select('product_ids').lean() : null,
        uid ? ShopFollower.find({ buyer_ids: uid }).select('shop_id').lean() : [],
        uid ? Shop.find({ owner_id: uid }).select('_id').lean() : [],
    ]) as [any[], any[], any[], any[], any, any, any[], any[]];

    const weights = new Map<string, number>();
    const add = (id: string, w: number) => { if (w > 0) weights.set(id, (weights.get(id) ?? 0) + w); };
    const bought = new Set<string>();
    const cartDone = new Set<string>();
    const viewCount = new Map<string, number>();

    for (const o of orders) {
        for (const it of o.items ?? []) {
            const id = String(it.product_id);
            bought.add(id);
            add(id, decayWeight(WEIGHTS.purchase, o.created_at));
        }
    }
    for (const e of events) {
        const id = String(e.product_id);
        if (e.event_type === 'add_to_cart') {
            if (!cartDone.has(id)) {
                cartDone.add(id);
                add(id, decayWeight(WEIGHTS.cart, e.created_at));
            }
        } else if ((viewCount.get(id) ?? 0) < VIEW_CAP) {
            viewCount.set(id, (viewCount.get(id) ?? 0) + 1);
            add(id, decayWeight(WEIGHTS.view, e.created_at));
        }
    }
    for (const log of logs) {
        for (const c of log.clicks ?? []) {
            add(String(c.product_id), decayWeight(WEIGHTS.click, c.clicked_at ?? log.created_at));
        }
    }
    const inCart = (cart?.items ?? []).map((i: any) => String(i.product_id));
    for (const id of inCart) {
        if (!cartDone.has(id)) {
            cartDone.add(id);
            add(id, WEIGHTS.cart);
        }
    }
    for (const id of wish?.product_ids ?? []) add(String(id), WEIGHTS.wishlist);

    const keywords = [...new Set([...p.q, ...recent.map(r => r.keyword)].map(k => nfcLower(k).slice(0, 50)).filter(Boolean))]
        .slice(0, MAX_KEYWORDS);
    const items = [...weights]
        .map(([productId, weight]) => ({ productId, weight }))
        .sort((a, b) => b.weight - a.weight);
    const excluded = [...new Set([...bought, ...inCart])].map(id => new mongoose.Types.ObjectId(id));

    return {
        items,
        keywords,
        followedShopIds: follows.map(f => String(f.shop_id)),
        ownShopIds: own.map(s => s._id),
        excluded,
    };
}
