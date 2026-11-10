import mongoose from 'mongoose';
import { Category } from '../../category/infrastructure/models/category.model';
import { PUBLIC_QUERY } from '../../product/application/product.service';
import { SELLER_FOLLOW_LIMIT, ShopService } from '../../product/application/shop.service';
import { Product } from '../../product/infrastructure/models/product.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { ShopFollower } from '../../product/infrastructure/models/shop-follower.model';
import { escapeRegex, normalizeVi } from '../../../shared/utils/vietnamese-search.util';

// F36 gian hàng thật: danh sách theo dõi là follow của sàn (tối đa 10, BR-201), AI chỉ đọc.

const SEARCH_LIMIT = 8;
const CATEGORY_LIMIT = 20;

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

    /**
     * SRS 3.9.5: hộp thêm shop tìm theo tên. Có categoryId thì chỉ lấy shop đang bán trong danh mục đó (gồm danh mục con),
     * shop nhiều sản phẩm xếp trước. Bỏ shop của chính mình, kèm cờ đã theo dõi.
     */
    static async searchShops(userId: string, query: string, categoryId?: string) {
        const me = new mongoose.Types.ObjectId(userId);
        const soSp = categoryId ? await this.countProductsByShop(categoryId) : null;
        const shops = await Shop.find({
            status: { $in: ['ACTIVE', null] },      // shop tạo trước khi có trường status coi như đang hoạt động
            owner_id: { $ne: me },
            ...(soSp ? { _id: { $in: [...soSp.keys()].map(id => new mongoose.Types.ObjectId(id)) } } : {}),
            // shop cũ có thể chưa có shop_name_norm nên tìm thêm trên tên gốc
            ...(query ? {
                $or: [
                    { shop_name_norm: { $regex: escapeRegex(normalizeVi(query)) } },
                    { shop_name: { $regex: escapeRegex(query), $options: 'i' } },
                ],
            } : {}),
        }).select('_id shop_name').limit(soSp ? 0 : SEARCH_LIMIT).lean();
        const ds = soSp
            ? shops.sort((a, b) => (soSp.get(String(b._id)) ?? 0) - (soSp.get(String(a._id)) ?? 0)).slice(0, CATEGORY_LIMIT)
            : shops;
        const followed = await ShopFollower.find({ shop_id: { $in: ds.map(s => s._id) }, buyer_ids: me }).select('shop_id').lean();
        const tracked = new Set(followed.map(f => String(f.shop_id)));
        return ds.map(s => ({
            shop_id: String(s._id),
            shop_name: s.shop_name,
            is_tracked: tracked.has(String(s._id)),
            ...(soSp ? { products_in_category: soSp.get(String(s._id)) ?? 0 } : {}),
        }));
    }

    /** Danh mục cấp 1 đang hoạt động, cho ô chọn danh mục khi tìm shop để theo dõi. */
    static async rootCategories() {
        const ds = await Category.find({ parent_id: null, is_active: true, status: { $ne: 'banned' }, review_status: { $ne: 'banned' } })
            .sort({ sort_order: 1, name: 1 }).select('_id name').lean();
        return ds.map(c => ({ id: String(c._id), name: c.name }));
    }

    /** Số sản phẩm đang bán của từng shop trong một danh mục và mọi danh mục con của nó. */
    private static async countProductsByShop(categoryId: string): Promise<Map<string, number>> {
        const all = await Category.find({}).select('_id parent_id').lean();
        const ids = new Set([categoryId]);
        // Lan xuống từng tầng con tới khi không thêm được danh mục nào nữa.
        for (let them = true; them;) {
            them = false;
            for (const c of all) {
                if (c.parent_id && ids.has(String(c.parent_id)) && !ids.has(String(c._id))) {
                    ids.add(String(c._id));
                    them = true;
                }
            }
        }
        const rows = await Product.aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([
            { $match: { ...PUBLIC_QUERY, category_ids: { $in: [...ids].map(id => new mongoose.Types.ObjectId(id)) } } },
            { $group: { _id: '$shop_id', n: { $sum: 1 } } },
        ]);
        return new Map(rows.map(r => [String(r._id), r.n]));
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
