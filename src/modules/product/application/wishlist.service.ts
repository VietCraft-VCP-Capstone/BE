import mongoose from 'mongoose';
import { Wishlist } from '../infrastructure/models/wishlist.model';
import { ProductVariant } from '../infrastructure/models/product-variant.model';

const PRODUCT_POPULATE = {
    path: 'product_ids',
    select: 'title images product_type shop_id listing_status',
    populate: {
        path: 'shop_id',
        select: 'shop_name logo'
    }
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
        const wishlist = await Wishlist.findOneAndUpdate(
            { user_id: uid },
            { $setOnInsert: { user_id: uid } },
            { new: true, upsert: true }
        ).populate(PRODUCT_POPULATE);

        if (!wishlist || !Array.isArray(wishlist.product_ids)) {
            return wishlist;
        }

        const productIds = wishlist.product_ids
            .map((p: any) => p?._id)
            .filter(Boolean);

        const variants = await ProductVariant.find({
            product_id: { $in: productIds }
        }).select('product_id sku color size material retail_price mockup_image stock_quantity is_active');

        const populatedProducts = wishlist.product_ids.map((p: any) => {
            if (!p || typeof p !== 'object' || !p._id) return p;
            const pObj = p.toObject ? p.toObject() : { ...p };
            const pVariants = variants.filter(v => v.product_id.toString() === pObj._id.toString());
            const mainVariant = pVariants.find(v => v.is_active !== false) || pVariants[0];
            const price = mainVariant ? parseFloat(mainVariant.retail_price?.toString() || '0') : 0;
            
            return {
                ...pObj,
                id: pObj._id.toString(),
                price,
                retail_price: price,
                variants: pVariants.map(v => ({
                    id: v._id.toString(),
                    _id: v._id.toString(),
                    sku: v.sku,
                    color: v.color,
                    size: v.size,
                    material: v.material,
                    name: [v.color, v.size, v.material].filter(Boolean).join(' - ') || 'Tiêu chuẩn',
                    price: parseFloat(v.retail_price?.toString() || '0'),
                    retail_price: parseFloat(v.retail_price?.toString() || '0'),
                    stock: Number(v.stock_quantity) || 0,
                    mockupImage: v.mockup_image
                })),
                shopInfo: pObj.shop_id ? {
                    id: pObj.shop_id._id?.toString() || pObj.shop_id.toString(),
                    name: pObj.shop_id.shop_name || 'VietCraft Selection',
                    logo: pObj.shop_id.logo
                } : undefined,
                shopName: pObj.shop_id?.shop_name || 'VietCraft Selection'
            };
        });

        const resultObj = wishlist.toObject ? wishlist.toObject() : { ...wishlist };
        resultObj.product_ids = populatedProducts;
        return resultObj;
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

