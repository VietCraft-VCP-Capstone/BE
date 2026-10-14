import mongoose from 'mongoose';
import { Shop } from '../infrastructure/models/shop.model';
import { ShopFollower } from '../infrastructure/models/shop-follower.model';
import { logger } from '../../../shared/utils/logger';

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
    reputation_score?: number;
    reputation_tier?: string;
    createdAt?: Date;
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

        const score = typeof shop.reputation_score === 'number' ? shop.reputation_score : 100;
        const tier = shop.reputation_tier || (score >= 90 ? 'TRUSTED' : score >= 70 ? 'NORMAL' : score >= 50 ? 'WARNING' : 'RESTRICTED');

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
            reputation_score: score,
            reputation_tier: tier,
            createdAt: shop.created_at,
        };
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
