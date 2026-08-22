import mongoose from 'mongoose';
import { Wishlist } from '../infrastructure/models/wishlist.model';

export class WishlistService {
    static async getWishlist(userId: string) {
        let wishlist = await Wishlist.findOne({ user_id: userId }).populate({
            path: 'product_ids',
            select: 'title images retail_price originalPrice rating product_type shop_id'
        });
        if (!wishlist) {
            wishlist = await Wishlist.create({ user_id: userId, product_ids: [] });
        }
        return wishlist;
    }

    static async toggleFavorite(userId: string, productId: string) {
        let wishlist = await Wishlist.findOne({ user_id: userId });
        if (!wishlist) {
            wishlist = await Wishlist.create({ user_id: userId, product_ids: [] });
        }

        const isAlreadyFav = wishlist.product_ids.some(id => id.toString() === productId);
        if (isAlreadyFav) {
            wishlist.product_ids = wishlist.product_ids.filter(id => id.toString() !== productId);
        } else {
            if (mongoose.Types.ObjectId.isValid(productId)) {
                wishlist.product_ids.push(new mongoose.Types.ObjectId(productId));
            }
        }
        await wishlist.save();
        return {
            isFavorite: !isAlreadyFav,
            message: !isAlreadyFav ? 'Đã thêm vào danh sách yêu thích' : 'Đã xóa khỏi danh sách yêu thích',
            wishlist: await this.getWishlist(userId)
        };
    }

    static async addFavorite(userId: string, productId: string) {
        let wishlist = await Wishlist.findOne({ user_id: userId });
        if (!wishlist) {
            wishlist = await Wishlist.create({ user_id: userId, product_ids: [] });
        }

        if (mongoose.Types.ObjectId.isValid(productId) && !wishlist.product_ids.some(id => id.toString() === productId)) {
            wishlist.product_ids.push(new mongoose.Types.ObjectId(productId));
            await wishlist.save();
        }

        return this.getWishlist(userId);
    }

    static async removeFavorite(userId: string, productId: string) {
        let wishlist = await Wishlist.findOne({ user_id: userId });
        if (wishlist) {
            wishlist.product_ids = wishlist.product_ids.filter(id => id.toString() !== productId);
            await wishlist.save();
        }
        return this.getWishlist(userId);
    }
}
