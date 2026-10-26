import mongoose from 'mongoose';
import { SELLER_FOLLOW_LIMIT, ShopService } from '../../product/application/shop.service';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { ShopFollower } from '../../product/infrastructure/models/shop-follower.model';
import { escapeRegex, normalizeVi } from '../../../shared/utils/vietnamese-search.util';

// F36 gian hàng thật: danh sách theo dõi là follow của sàn (tối đa 10, BR-201), AI chỉ đọc.

const SEARCH_LIMIT = 8;

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
            // BR-204: job cảnh báo chỉ đọc follow hiện tại; thông báo đã gửi nằm trong notifications, không bị xoá.
            note: 'Đã bỏ theo dõi. Bạn sẽ không nhận cảnh báo mới về gian hàng này; cảnh báo đã gửi vẫn còn trong mục Thông báo.',
            slots_used: await ShopService.countFollowing(userId),
            slots_limit: SELLER_FOLLOW_LIMIT,
        };
    }

    /** SRS 3.9.5: hộp thêm shop tìm theo tên. Bỏ shop của chính mình, kèm cờ đã theo dõi. */
    static async searchShops(userId: string, query: string) {
        const me = new mongoose.Types.ObjectId(userId);
        const shops = await Shop.find({
            status: { $in: ['ACTIVE', null] },      // shop tạo trước khi có trường status coi như đang hoạt động
            owner_id: { $ne: me },
            // shop cũ có thể chưa có shop_name_norm nên tìm thêm trên tên gốc
            $or: [
                { shop_name_norm: { $regex: escapeRegex(normalizeVi(query)) } },
                { shop_name: { $regex: escapeRegex(query), $options: 'i' } },
            ],
        }).select('_id shop_name').limit(SEARCH_LIMIT).lean();
        const followed = await ShopFollower.find({ shop_id: { $in: shops.map(s => s._id) }, buyer_ids: me }).select('shop_id').lean();
        const tracked = new Set(followed.map(f => String(f.shop_id)));
        return shops.map(s => ({ shop_id: String(s._id), shop_name: s.shop_name, is_tracked: tracked.has(String(s._id)) }));
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
