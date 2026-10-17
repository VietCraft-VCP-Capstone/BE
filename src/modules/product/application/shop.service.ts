import mongoose from 'mongoose';
import { Shop } from '../infrastructure/models/shop.model';
import { ShopFollower } from '../infrastructure/models/shop-follower.model';
import { logger } from '../../../shared/utils/logger';

/**
 * BR-201: với người bán, theo dõi một gian hàng chính là theo dõi đối thủ — cùng danh sách
 * với mục "Theo dõi đối thủ" của khu Phân tích — nên tối đa 10 gian hàng. Người mua không giới hạn.
 */
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
    /**
     * Tìm gian hàng theo ObjectId hoặc slug
     */
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

    /**
     * Lấy thông tin chi tiết gian hàng
     */
    static async getShopDetail(shopIdOrSlug: string, currentUserId?: string): Promise<ShopDetailDTO> {
        const shop = await ShopService.resolveShop(shopIdOrSlug);
        if (!shop) {
            throw new Error('Không tìm thấy thông tin gian hàng.');
        }

        const followerDoc = await ShopFollower.findOne({ shop_id: shop._id }).lean();
        const followersCount = followerDoc?.buyer_ids?.length || 0;
        const isFollowing = Boolean(
            currentUserId &&
            followerDoc?.buyer_ids?.some(id => id.toString() === currentUserId)
        );

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
            logo: shop.logo || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
            banner: shop.banner || 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&q=80&w=1200',
            description: shop.description || '',
            rating: typeof shop.average_rating === 'number' ? shop.average_rating : 5.0,
            averageRating: typeof shop.average_rating === 'number' ? shop.average_rating : 5.0,
            ratingCount: typeof shop.rating_count === 'number' ? shop.rating_count : 0,
            listingCount: typeof shop.listing_count === 'number' ? shop.listing_count : 0,
            followersCount,
            isFollowing,
            createdAt: shop.created_at,
            shippingSettings,
        };
    }

    /**
     * Số gian hàng người dùng đang theo dõi.
     */
    static async countFollowing(userId: string): Promise<number> {
        return ShopFollower.countDocuments({ buyer_ids: new mongoose.Types.ObjectId(userId) });
    }

    /**
     * Người dùng có đang theo dõi gian hàng này không.
     */
    static async isFollowing(shopId: mongoose.Types.ObjectId | string, userId: string): Promise<boolean> {
        const found = await ShopFollower.exists({ shop_id: shopId, buyer_ids: new mongoose.Types.ObjectId(userId) });
        return Boolean(found);
    }

    /**
     * Chặn người bán theo dõi quá SELLER_FOLLOW_LIMIT gian hàng (BR-201).
     * Theo dõi lại gian hàng đang theo dõi thì không tốn thêm chỗ.
     */
    static async assertSellerFollowSlot(shopIdOrSlug: string, userId: string): Promise<void> {
        const shop = await ShopService.resolveShop(shopIdOrSlug);
        if (!shop || await ShopService.isFollowing(shop._id, userId)) return;
        if (await ShopService.countFollowing(userId) >= SELLER_FOLLOW_LIMIT) {
            throw new FollowLimitError();
        }
    }

    /**
     * Theo dõi gian hàng
     */
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

        const followersCount = updated?.buyer_ids?.length || 0;
        logger.info(`[ShopFollow] Buyer ${buyerId} followed Shop ${shop._id} (total: ${followersCount})`);

        return {
            success: true,
            message: 'Đã theo dõi gian hàng.',
            shopId: shop._id.toString(),
            isFollowing: true,
            followersCount
        };
    }

    /**
     * Hủy theo dõi gian hàng
     */
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

        const followersCount = updated?.buyer_ids?.length || 0;
        logger.info(`[ShopFollow] Buyer ${buyerId} unfollowed Shop ${shop._id} (total: ${followersCount})`);

        return {
            success: true,
            message: 'Đã hủy theo dõi gian hàng.',
            shopId: shop._id.toString(),
            isFollowing: false,
            followersCount
        };
    }

    /**
     * Lấy danh sách các gian hàng mà người dùng đang theo dõi
     */
    static async getFollowedShops(userId: string): Promise<ShopDetailDTO[]> {
        if (!userId) return [];
        const userObjectId = new mongoose.Types.ObjectId(userId);

        const followerDocs = await ShopFollower.find({ buyer_ids: userObjectId }).lean();
        if (!followerDocs || followerDocs.length === 0) {
            return [];
        }

        const shopIds = followerDocs.map(doc => doc.shop_id);
        const shops = await Shop.find({ _id: { $in: shopIds } }).lean();

        const countMap = new Map<string, number>();
        followerDocs.forEach(doc => {
            countMap.set(doc.shop_id.toString(), doc.buyer_ids?.length || 0);
        });

        return shops.map(shop => {
            const sId = shop._id.toString();
            return {
                id: sId,
                _id: sId,
                name: shop.shop_name,
                shopName: shop.shop_name,
                slug: shop.slug,
                logo: shop.logo || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
                banner: shop.banner || 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&q=80&w=1200',
                description: shop.description || '',
                rating: typeof shop.average_rating === 'number' ? shop.average_rating : 5.0,
                averageRating: typeof shop.average_rating === 'number' ? shop.average_rating : 5.0,
                ratingCount: typeof shop.rating_count === 'number' ? shop.rating_count : 0,
                listingCount: typeof shop.listing_count === 'number' ? shop.listing_count : 0,
                followersCount: countMap.get(sId) || 0,
                isFollowing: true,
                createdAt: shop.created_at,
            };
        });
    }
}
