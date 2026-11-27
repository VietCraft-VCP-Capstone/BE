import mongoose from 'mongoose';
import { Shop } from '../infrastructure/models/shop.model';
import { ShopFollower } from '../infrastructure/models/shop-follower.model';
import { logger } from '../../../shared/utils/logger';
import { User } from '../../user/infrastructure/models/user.model';

// Cùng luật PUBLIC_QUERY ở product.service (không import để tránh vòng phụ thuộc).
const PUBLIC_PRODUCT_MATCH = { status: 'PUBLISHED', is_hidden: { $ne: true }, moderation_status: 'APPROVED' };

// BR-201: người bán theo dõi gian hàng = theo dõi đối thủ, tối đa 10; người mua không giới hạn.
export const SELLER_FOLLOW_LIMIT = 10;

export class FollowLimitError extends Error {
    readonly code = 'tracking_limit_reached';
    readonly limit = SELLER_FOLLOW_LIMIT;

    constructor() {
        super(`Bạn đã theo dõi tối đa ${SELLER_FOLLOW_LIMIT} gian hàng đối thủ. Bỏ theo dõi bớt một gian hàng để theo dõi gian hàng mới.`);
    }
}

export interface ShopDetailDTO {
    id: string;
    _id: string;
    name: string;
    shopName: string;
    slug: string;
    logo: string;
    banner: string;
    description: string;
    rating: number;
    averageRating: number;
    ratingCount: number;
    listingCount: number;
    followersCount: number;
    isFollowing: boolean;
    isOwner?: boolean;
    returnPolicy?: string;
    reputation_score?: number;
    reputation_tier?: string;
    createdAt?: Date;
    shippingSettings?: {
        pricingType?: 'FLAT_RATE' | 'ZONE_BASED';
        useFlatRate?: boolean;
        flatRateFee?: number;
        province?: string;
        district?: string;
        ward?: string;
        carriers?: Array<{
            id: string;
            name: string;
            enabled: boolean;
            estimatedTime?: string;
        }>;
        zoneRates?: {
            intraProvince: number;
            intraRegion: number;
            interRegion: number;
        };
    } | null;
}

export class ShopService {
    // Điểm shop tính thẳng từ reviews (bỏ review bị báo cáo, như phần đánh giá sản phẩm); trường lưu trên shops có thể lệch.
    static async liveRatings(shopIds: mongoose.Types.ObjectId[]): Promise<Map<string, { averageRating: number; ratingCount: number }>> {
        const rows = await mongoose.connection.collection('reviews').aggregate([
            { $match: { shop_id: { $in: shopIds }, is_reported: { $ne: true } } },
            { $group: { _id: '$shop_id', avg: { $avg: '$rating' }, n: { $sum: 1 } } },
        ]).toArray();
        return new Map(rows.map(r => [String(r._id), { averageRating: Number(r.avg.toFixed(1)), ratingCount: r.n }]));
    }

    /**
     * Số người theo dõi = số tài khoản CÒN TỒN TẠI trong danh sách (tài khoản đã xoá không được tính),
     * để con số hiển thị luôn khớp với người thật có thể nhận thông báo từ shop.
     */
    static async liveFollowerCounts(docs: Array<{ shop_id: any; buyer_ids?: any[] }>): Promise<Map<string, number>> {
        const allIds = [...new Set(docs.flatMap(d => (d.buyer_ids || []).map(String)))];
        if (allIds.length === 0) return new Map();
        const existing = await User.find({ _id: { $in: allIds } }).select('_id').lean();
        const alive = new Set(existing.map((u: any) => String(u._id)));
        return new Map(docs.map(d => [String(d.shop_id), new Set((d.buyer_ids || []).map(String).filter(id => alive.has(id))).size]));
    }

    /** Số sản phẩm khách xem được của mỗi shop (cùng luật PUBLIC_QUERY), thay cho listing_count lưu sẵn. */
    static async publicProductCounts(shopIds: mongoose.Types.ObjectId[]): Promise<Map<string, number>> {
        if (shopIds.length === 0) return new Map();
        const rows = await mongoose.connection.collection('products').aggregate([
            { $match: { shop_id: { $in: shopIds }, ...PUBLIC_PRODUCT_MATCH } },
            { $group: { _id: '$shop_id', n: { $sum: 1 } } },
        ]).toArray();
        return new Map(rows.map(r => [String(r._id), r.n as number]));
    }

    static async resolveShop(shopIdOrSlug: string) {
        let shop = null;
        if (mongoose.Types.ObjectId.isValid(shopIdOrSlug)) {
            shop = await Shop.findById(shopIdOrSlug);
        }
        if (!shop) {
            shop = await Shop.findOne({ slug: shopIdOrSlug });
        }
        return shop;
    }

    static async getShopDetail(shopIdOrSlug: string, currentUserId?: string): Promise<ShopDetailDTO> {
        const shop = await ShopService.resolveShop(shopIdOrSlug);
        if (!shop) {
            throw new Error('Không tìm thấy thông tin gian hàng.');
        }

        const [followerDoc, ratings, productCount] = await Promise.all([
            ShopFollower.findOne({ shop_id: shop._id }).lean(),
            ShopService.liveRatings([shop._id]),
            ShopService.publicProductCounts([shop._id]).then(m => m.get(shop._id.toString()) ?? 0),
        ]);
        const rating = ratings.get(shop._id.toString()) ?? { averageRating: 0, ratingCount: 0 };
        const followersCount = followerDoc
            ? (await ShopService.liveFollowerCounts([followerDoc])).get(shop._id.toString()) ?? 0
            : 0;
        const isFollowing = Boolean(
            currentUserId &&
            followerDoc?.buyer_ids?.some(id => id.toString() === currentUserId)
        );

        const score = typeof shop.reputation_score === 'number' ? shop.reputation_score : 80;
        const tier = shop.reputation_tier || (score >= 90 ? 'TRUSTED' : score >= 70 ? 'NORMAL' : score >= 50 ? 'WARNING' : 'RESTRICTED');
        const rawShipping = shop.settings?.shipping;
        const shippingSettings = rawShipping ? {
            pricingType: rawShipping.pricingType || (rawShipping.useFlatRate ? 'FLAT_RATE' : 'ZONE_BASED'),
            useFlatRate: rawShipping.pricingType === 'FLAT_RATE' || Boolean(rawShipping.useFlatRate),
            flatRateFee: Number(rawShipping.flatRateFee ?? 0),
            province: rawShipping.province || '',
            district: rawShipping.district || '',
            ward: rawShipping.ward || '',
            carriers: rawShipping.carriers || [],
            zoneRates: rawShipping.zoneRates || {
                intraProvince: 22000,
                intraRegion: 30000,
                interRegion: 38000
            }
        } : null;

        return {
            id: shop._id.toString(),
            _id: shop._id.toString(),
            name: shop.shop_name,
            shopName: shop.shop_name,
            slug: shop.slug,
            logo: shop.logo || '',
            banner: shop.banner || '',
            description: shop.description || '',
            rating: rating.averageRating,
            averageRating: rating.averageRating,
            ratingCount: rating.ratingCount,
            listingCount: productCount,
            followersCount,
            isFollowing,
            isOwner: Boolean(currentUserId && shop.owner_id && shop.owner_id.toString() === currentUserId),
            returnPolicy: shop.return_policy || '',
            reputation_score: score,
            reputation_tier: tier,
            createdAt: shop.created_at,
            shippingSettings,
        };
    }

    static async countFollowing(userId: string): Promise<number> {
        return ShopFollower.countDocuments({ buyer_ids: new mongoose.Types.ObjectId(userId) });
    }

    static async isFollowing(shopId: mongoose.Types.ObjectId | string, userId: string): Promise<boolean> {
        const found = await ShopFollower.exists({ shop_id: shopId, buyer_ids: new mongoose.Types.ObjectId(userId) });
        return Boolean(found);
    }

    // Theo dõi lại gian hàng đang theo dõi thì không tốn thêm chỗ (BR-201).
    static async assertSellerFollowSlot(shopIdOrSlug: string, userId: string): Promise<void> {
        const shop = await ShopService.resolveShop(shopIdOrSlug);
        if (!shop || await ShopService.isFollowing(shop._id, userId)) return;
        if (await ShopService.countFollowing(userId) >= SELLER_FOLLOW_LIMIT) {
            throw new FollowLimitError();
        }
    }

    static async followShop(shopIdOrSlug: string, buyerId: string) {
        const shop = await ShopService.resolveShop(shopIdOrSlug);
        if (!shop) {
            throw new Error('Không tìm thấy thông tin gian hàng.');
        }

        if (shop.owner_id && shop.owner_id.toString() === buyerId) {
            throw new Error('Bạn không thể tự theo dõi gian hàng của chính mình.');
        }

        const buyerObjectId = new mongoose.Types.ObjectId(buyerId);

        const updated = await ShopFollower.findOneAndUpdate(
            { shop_id: shop._id },
            { $addToSet: { buyer_ids: buyerObjectId } },
            { upsert: true, new: true }
        );

        const followersCount = updated ? (await ShopService.liveFollowerCounts([updated])).get(shop._id.toString()) ?? 0 : 0;
        logger.info(`[ShopFollow] Buyer ${buyerId} followed Shop ${shop._id} (total: ${followersCount})`);

        return {
            success: true,
            message: 'Đã theo dõi gian hàng.',
            shopId: shop._id.toString(),
            isFollowing: true,
            followersCount
        };
    }

    static async unfollowShop(shopIdOrSlug: string, buyerId: string) {
        const shop = await ShopService.resolveShop(shopIdOrSlug);
        if (!shop) {
            throw new Error('Không tìm thấy thông tin gian hàng.');
        }

        const buyerObjectId = new mongoose.Types.ObjectId(buyerId);

        const updated = await ShopFollower.findOneAndUpdate(
            { shop_id: shop._id },
            { $pull: { buyer_ids: buyerObjectId } },
            { new: true }
        );

        const followersCount = updated ? (await ShopService.liveFollowerCounts([updated])).get(shop._id.toString()) ?? 0 : 0;
        logger.info(`[ShopFollow] Buyer ${buyerId} unfollowed Shop ${shop._id} (total: ${followersCount})`);

        return {
            success: true,
            message: 'Đã hủy theo dõi gian hàng.',
            shopId: shop._id.toString(),
            isFollowing: false,
            followersCount
        };
    }

    static async getFollowedShops(userId: string): Promise<ShopDetailDTO[]> {
        if (!userId) return [];
        const userObjectId = new mongoose.Types.ObjectId(userId);

        const followerDocs = await ShopFollower.find({ buyer_ids: userObjectId }).lean();
        if (!followerDocs || followerDocs.length === 0) {
            return [];
        }

        const shopIds = followerDocs.map(doc => doc.shop_id);
        const [shops, ratings, productCounts] = await Promise.all([
            Shop.find({ _id: { $in: shopIds } }).lean(),
            ShopService.liveRatings(shopIds),
            ShopService.publicProductCounts(shopIds),
        ]);

        const countMap = await ShopService.liveFollowerCounts(followerDocs);

        return shops.map(shop => {
            const sId = shop._id.toString();
            const rating = ratings.get(sId) ?? { averageRating: 0, ratingCount: 0 };
            return {
                id: sId,
                _id: sId,
                name: shop.shop_name,
                shopName: shop.shop_name,
                slug: shop.slug,
                logo: shop.logo || '',
                banner: shop.banner || '',
                description: shop.description || '',
                rating: rating.averageRating,
                averageRating: rating.averageRating,
                ratingCount: rating.ratingCount,
                listingCount: productCounts.get(sId) ?? 0,
                followersCount: countMap.get(sId) || 0,
                isFollowing: true,
                createdAt: shop.created_at,
            };
        });
    }
}
