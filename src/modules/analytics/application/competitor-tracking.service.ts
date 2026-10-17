import { SELLER_FOLLOW_LIMIT, ShopService } from '../../product/application/shop.service';

// F36 gian hàng thật: danh sách theo dõi là follow của sàn (tối đa 10, BR-201), AI chỉ đọc.

export class TrackingError extends Error {
    constructor(readonly status: number, readonly body: Record<string, unknown>) {
        super(String(body.error));
    }
}

export interface TrackingResult {
    tracked_shop_id: string;
    slots_used: number;
    slots_limit: number;
    [key: string]: unknown;
}

export class CompetitorTrackingService {
    static async track(userId: string, target: string): Promise<TrackingResult> {
        const shop = await ShopService.resolveShop(target);
        if (!shop) throw new TrackingError(404, { error: 'not_found', resource: 'shop' });
        if (String(shop.owner_id) === userId) {
            throw new TrackingError(400, { error: 'invalid_param', field: 'shop_id', expected: 'không thể tự theo dõi chính shop mình' });
        }
        // BR-202
        if (await ShopService.isFollowing(shop._id, userId)) {
            throw new TrackingError(400, { error: 'invalid_param', field: 'shop_id', expected: 'already_tracked' });
        }
        // BR-201
        const used = await ShopService.countFollowing(userId);
        if (used >= SELLER_FOLLOW_LIMIT) {
            throw new TrackingError(400, { error: 'tracking_limit_reached', limit: SELLER_FOLLOW_LIMIT });
        }

        await ShopService.followShop(String(shop._id), userId);
        return {
            tracked_shop_id: String(shop._id),
            tracked_shop_name: shop.shop_name,
            slots_used: used + 1,
            slots_limit: SELLER_FOLLOW_LIMIT,
        };
    }

    static async untrack(userId: string, target: string): Promise<TrackingResult> {
        const shop = await ShopService.resolveShop(target);
        if (!shop) throw new TrackingError(404, { error: 'not_found', resource: 'shop' });
        if (!(await ShopService.isFollowing(shop._id, userId))) {
            throw new TrackingError(404, { error: 'not_found', resource: 'tracking' });
        }

        await ShopService.unfollowShop(String(shop._id), userId);
        return {
            tracked_shop_id: String(shop._id),
            active: false,
            // AI tính cảnh báo tại chỗ từ follow của sàn, nên bỏ theo dõi là mất luôn cảnh báo của shop đó.
            note: 'Đã bỏ theo dõi. Cảnh báo của gian hàng này sẽ không còn hiện.',
            slots_used: await ShopService.countFollowing(userId),
            slots_limit: SELLER_FOLLOW_LIMIT,
        };
    }

    /** Khối meta theo hợp đồng phân tích, để phản hồi ghi có cùng vỏ với mọi phản hồi khác. */
    static meta(shopId: string | null, sampleSize: number) {
        return {
            status: 'ok',
            computed_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
            model_version: 'tracker-live-1.0',
            scope: 'shop',
            scope_id: shopId,
            source: { database: 'vietcraft', collection: 'shop_followers', mode: 'live', attributed_to_live_shop: true },
            quality: { sample_size: sampleSize, identity_linked: true, confidence: 'high' },
        };
    }
}
