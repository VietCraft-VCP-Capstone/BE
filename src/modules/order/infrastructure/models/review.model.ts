import mongoose, { Schema, Document, Model } from 'mongoose';
import { Product } from '../../../product/infrastructure/models/product.model';
import { Shop } from '../../../product/infrastructure/models/shop.model';
import { logger } from '../../../../shared/utils/logger';

export interface IReview extends Document {
    product_id: mongoose.Types.ObjectId;
    shop_id: mongoose.Types.ObjectId;
    buyer_id: mongoose.Types.ObjectId;
    order_id: mongoose.Types.ObjectId;
    rating: number;
    comment?: string;
    images: string[];
    seller_response?: string;
    replied_at?: Date;
    is_reported: boolean;
    created_at: Date;
    updated_at: Date;
}

export interface IReviewModel extends Model<IReview> {
    recalculateRatings(productId: mongoose.Types.ObjectId, shopId: mongoose.Types.ObjectId): Promise<void>;
}

const ReviewSchema = new Schema<IReview, IReviewModel>({
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    buyer_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1000 },
    images: {
        type: [String],
        default: [],
        validate: [(val: string[]) => val.length <= 5, 'Tối đa 5 ảnh đính kèm']
    },
    seller_response: { type: String, trim: true, maxlength: 1000 },
    replied_at: { type: Date },
    is_reported: { type: Boolean, default: false }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Chặn trùng lặp: 1 đơn hàng + 1 sản phẩm chỉ được review đúng 1 lần
ReviewSchema.index({ order_id: 1, product_id: 1 }, { unique: true });

// Hỗ trợ phân trang và lọc theo rating ở trang Product Detail
ReviewSchema.index({ product_id: 1, rating: -1, created_at: -1 });

// Hỗ trợ truy vấn đánh giá theo shop
ReviewSchema.index({ shop_id: 1, created_at: -1 });

/**
 * Static method recalculateRatings:
 * Tính toán lại average_rating và rating_count cho Product và Shop bằng Aggregation Pipeline.
 */
ReviewSchema.statics.recalculateRatings = async function (
    productId: mongoose.Types.ObjectId,
    shopId: mongoose.Types.ObjectId
): Promise<void> {
    try {
        // 1. Tính toán điểm cho Product
        const productStats = await this.aggregate([
            { $match: { product_id: productId } },
            {
                $group: {
                    _id: '$product_id',
                    avgRating: { $avg: '$rating' },
                    totalReviews: { $sum: 1 }
                }
            }
        ]);

        const pAvg = productStats.length > 0 ? Number(productStats[0].avgRating.toFixed(1)) : 5.0;
        const pCount = productStats.length > 0 ? productStats[0].totalReviews : 0;

        await Product.findByIdAndUpdate(productId, {
            average_rating: pAvg,
            rating_count: pCount
        });

        // 2. Tính toán điểm cho Shop
        const shopStats = await this.aggregate([
            { $match: { shop_id: shopId } },
            {
                $group: {
                    _id: '$shop_id',
                    avgRating: { $avg: '$rating' },
                    totalReviews: { $sum: 1 }
                }
            }
        ]);

        const sAvg = shopStats.length > 0 ? Number(shopStats[0].avgRating.toFixed(1)) : 5.0;
        const sCount = shopStats.length > 0 ? shopStats[0].totalReviews : 0;

        await Shop.findByIdAndUpdate(shopId, {
            average_rating: sAvg,
            rating_count: sCount
        });

        logger.info(`[Review Aggregation] Product (${productId}): ${pAvg}* (${pCount} reviews) | Shop (${shopId}): ${sAvg}* (${sCount} reviews)`);
    } catch (err: any) {
        logger.error(`[Review Aggregation Error]: ${err?.message || err}`);
    }
};

export const Review = mongoose.model<IReview, IReviewModel>('Review', ReviewSchema, 'reviews');
