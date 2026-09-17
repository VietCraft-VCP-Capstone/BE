import mongoose from 'mongoose';
import { Wishlist } from '../infrastructure/models/wishlist.model';
import ProductsService from './product.service';

function toObjectId(id: string, label: string): mongoose.Types.ObjectId {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new Error(`${label} không hợp lệ.`);
    }
    return new mongoose.Types.ObjectId(id);
}

export class WishlistService {
    static async getWishlist(userId: string) {
        const uid = toObjectId(userId, 'ID người dùng');
        const wishlist = await Wishlist.findOneAndUpdate(
            { user_id: uid },
            { $setOnInsert: { user_id: uid } },
            { new: true, upsert: true }
        ).lean();

        const productIds = wishlist.product_ids || [];
        if (productIds.length === 0) {
            return {
                ...wishlist,
                product_ids: [],
                items: []
            };
        }

        const items = await ProductsService.getByIds(productIds);

        // Tự động dọn dẹp các ID sản phẩm không còn tồn tại
        const existingIds = new Set(items.map(it => it.id));
        const validProductIds = productIds.filter(id => existingIds.has(id.toString()));
        if (validProductIds.length !== productIds.length) {
            await Wishlist.updateOne(
                { _id: wishlist._id },
                { $set: { product_ids: validProductIds } }
            );
        }

        return {
            ...wishlist,
            product_ids: validProductIds.map(id => id.toString()),
            items
        };
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

