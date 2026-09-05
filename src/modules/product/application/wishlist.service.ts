import mongoose from 'mongoose';
import { Wishlist } from '../infrastructure/models/wishlist.model';

const PRODUCT_POPULATE = {
    path: 'product_ids',
    select: 'title images retail_price originalPrice rating product_type shop_id'
};

function toObjectId(id: string, label: string): mongoose.Types.ObjectId {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new Error(`${label} không hợp lệ.`);
    }
    return new mongoose.Types.ObjectId(id);
}

export class WishlistService {
    static async getWishlist(userId: string) {
        const uid = toObjectId(userId, 'ID người dùng');
        return Wishlist.findOneAndUpdate(
            { user_id: uid },
            { $setOnInsert: { user_id: uid } },
            { new: true, upsert: true }
        ).populate(PRODUCT_POPULATE);
    }

    static async getProductIds(userId: string): Promise<string[]> {
        const uid = toObjectId(userId, 'ID người dùng');
        const wishlist = await Wishlist.findOne({ user_id: uid }).select('product_ids');
        return (wishlist?.product_ids || []).map((id) => id.toString());
    }

    static async toggleFavorite(userId: string, productId: string) {
        const uid = toObjectId(userId, 'ID người dùng');
        const pid = toObjectId(productId, 'ID sản phẩm');

        const existing = await Wishlist.exists({ user_id: uid, product_ids: pid });
        const isFavorite = !existing;

        await Wishlist.updateOne(
            { user_id: uid },
            isFavorite ? { $addToSet: { product_ids: pid } } : { $pull: { product_ids: pid } },
            { upsert: true }
        );

        return {
            isFavorite,
            message: isFavorite ? 'Đã thêm vào danh sách yêu thích' : 'Đã xóa khỏi danh sách yêu thích',
            wishlist: await this.getWishlist(userId)
        };
    }

    static async addFavorite(userId: string, productId: string) {
        const uid = toObjectId(userId, 'ID người dùng');
        const pid = toObjectId(productId, 'ID sản phẩm');
        await Wishlist.updateOne({ user_id: uid }, { $addToSet: { product_ids: pid } }, { upsert: true });
        return this.getWishlist(userId);
    }

    static async removeFavorite(userId: string, productId: string) {
        const uid = toObjectId(userId, 'ID người dùng');
        const pid = toObjectId(productId, 'ID sản phẩm');
        await Wishlist.updateOne({ user_id: uid }, { $pull: { product_ids: pid } }, { upsert: true });
        return this.getWishlist(userId);
    }
}

