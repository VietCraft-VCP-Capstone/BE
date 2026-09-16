import mongoose from 'mongoose';
import { Review } from '../infrastructure/models/review.model';
import { Order } from '../infrastructure/models/order.model';
import { Product } from '../../product/infrastructure/models/product.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { isCloudinaryEnabled, uploadImage } from '../../../infrastructure/storage/cloudinary.service';
import { publicUrl, resolveUploadPath } from '../../../shared/upload/upload.middleware';
import sharp from 'sharp';
import fs from 'fs';

export interface CreateReviewDTO {
    orderId: string;
    productId: string;
    rating: number;
    comment?: string;
    images?: string[];
}

export interface ReviewFilterQuery {
    page?: number;
    limit?: number;
    rating?: number;
}

export class ReviewService {
    /**
     * Tạo đánh giá mới cho sản phẩm trong đơn hàng đã nhận
     */
    static async createReview(buyerId: string, payload: CreateReviewDTO) {
        const { orderId, productId, rating, comment, images } = payload;

        if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
            throw new Error('ID sản phẩm không hợp lệ.');
        }

        const numRating = Number(rating);
        if (isNaN(numRating) || numRating < 1 || numRating > 5) {
            throw new Error('Điểm đánh giá phải từ 1 đến 5 sao.');
        }

        const bId = new mongoose.Types.ObjectId(buyerId);
        const pId = new mongoose.Types.ObjectId(productId);

        // 1. Kiểm tra đơn hàng thuộc quyền của Buyer và đã giao thành công (hỗ trợ cả _id lẫn order_code)
        const orderQuery: any = { buyer_id: bId };
        if (mongoose.Types.ObjectId.isValid(orderId)) {
            orderQuery.$or = [{ _id: new mongoose.Types.ObjectId(orderId) }, { order_code: orderId }];
        } else if (orderId) {
            orderQuery.order_code = orderId;
        } else {
            throw new Error('ID đơn hàng không hợp lệ.');
        }

        const order = await Order.findOne(orderQuery).lean();

        if (!order) {
            throw new Error('Đơn hàng không tồn tại hoặc bạn không có quyền đánh giá đơn này.');
        }

        if (order.order_status !== 'DELIVERED') {
            throw new Error('Bạn chỉ có thể đánh giá sản phẩm sau khi đơn hàng đã được giao thành công.');
        }

        // 2. Kiểm tra sản phẩm có trong đơn hàng
        const hasProduct = order.items && order.items.some(
            (item: any) => item.product_id && item.product_id.toString() === productId
        );

        if (!hasProduct) {
            throw new Error('Sản phẩm không nằm trong danh sách các món của đơn hàng này.');
        }

        const oId = order._id as mongoose.Types.ObjectId;

        // 3. Kiểm tra xem đã từng review sản phẩm này trong đơn hàng chưa
        const existingReview = await Review.findOne({
            order_id: oId,
            product_id: pId
        }).lean();

        if (existingReview) {
            throw new Error('Bạn đã gửi đánh giá cho sản phẩm này trong đơn hàng này rồi.');
        }

        // 4. Lấy thông tin sản phẩm và kiểm tra Shop
        const product = await Product.findById(pId).lean();
        if (!product) {
            throw new Error('Sản phẩm không còn tồn tại trên hệ thống.');
        }

        const shopId = product.shop_id;
        const shop = await Shop.findById(shopId).lean();
        if (shop && shop.owner_id && shop.owner_id.toString() === buyerId) {
            throw new Error('Bạn không thể tự đánh giá sản phẩm từ gian hàng của chính mình.');
        }

        // 5. Tạo Review mới
        const cleanedImages = Array.isArray(images)
            ? images.filter(img => typeof img === 'string' && img.trim().length > 0).slice(0, 5)
            : [];

        const newReview = await Review.create({
            order_id: oId,
            product_id: pId,
            shop_id: shopId,
            buyer_id: bId,
            rating: Math.round(numRating),
            comment: (comment || '').trim(),
            images: cleanedImages
        });

        // 6. Tính toán lại rating trung bình cho Product và Shop (chạy ngầm)
        Review.recalculateRatings(pId, shopId as mongoose.Types.ObjectId).catch(err => {
            console.error('[Review Recalculate Error]:', err);
        });

        return {
            id: newReview._id.toString(),
            orderId: newReview.order_id.toString(),
            productId: newReview.product_id.toString(),
            rating: newReview.rating,
            comment: newReview.comment,
            text: newReview.comment,
            images: newReview.images,
            createdAt: newReview.created_at
        };
    }

    /**
     * Lấy danh sách đánh giá tại trang chi tiết sản phẩm
     */
    static async getProductReviews(productId: string, query: ReviewFilterQuery) {
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            throw new Error('ID sản phẩm không hợp lệ.');
        }

        const pId = new mongoose.Types.ObjectId(productId);
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));
        const skip = (page - 1) * limit;

        const filter: any = { product_id: pId, is_reported: false };
        if (query.rating && query.rating >= 1 && query.rating <= 5) {
            filter.rating = Number(query.rating);
        }

        const [items, totalItems, breakdownRaw] = await Promise.all([
            Review.find(filter)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit)
                .populate('buyer_id', 'full_name avatar')
                .lean(),
            Review.countDocuments(filter),
            Review.aggregate([
                { $match: { product_id: pId, is_reported: false } },
                { $group: { _id: '$rating', count: { $sum: 1 } } }
            ])
        ]);

        const breakdown: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
        let sumRating = 0;
        let totalCount = 0;

        breakdownRaw.forEach((b: { _id: number; count: number }) => {
            if (breakdown[String(b._id)] !== undefined) {
                breakdown[String(b._id)] = b.count;
                sumRating += b._id * b.count;
                totalCount += b.count;
            }
        });

        const averageRating = totalCount > 0 ? Number((sumRating / totalCount).toFixed(1)) : 5.0;

        const percentages: Record<string, string> = {};
        const percentageNumbers: Record<string, number> = {};
        for (let s = 1; s <= 5; s++) {
            const pct = totalCount > 0 ? Math.round((breakdown[String(s)] / totalCount) * 100) : 0;
            percentages[String(s)] = `${pct}%`;
            percentageNumbers[String(s)] = pct;
        }

        const formatDate = (date: any) => {
            if (!date) return '';
            const d = new Date(date);
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}/${month}/${year}`;
        };

        return {
            summary: {
                averageRating,
                totalReviews: totalCount,
                reviewCount: totalCount,
                breakdown,
                percentages,
                percentageNumbers
            },
            pagination: {
                page,
                limit,
                totalItems,
                totalPages: Math.ceil(totalItems / limit)
            },
            items: items.map(rev => {
                const buyerName = (rev.buyer_id as any)?.full_name || 'Khách hàng';
                const buyerAvatar = (rev.buyer_id as any)?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100';
                return {
                    id: rev._id.toString(),
                    rating: rev.rating,
                    comment: rev.comment || '',
                    text: rev.comment || '',
                    name: buyerName,
                    avatar: buyerAvatar,
                    date: formatDate(rev.created_at),
                    images: rev.images || [],
                    sellerResponse: rev.seller_response,
                    repliedAt: rev.replied_at,
                    createdAt: rev.created_at,
                    buyer: {
                        name: buyerName,
                        avatar: buyerAvatar
                    }
                };
            })
        };
    }

    /**
     * Lấy đánh giá của Buyer cho một item trong đơn hàng cụ thể
     */
    static async getOrderProductReview(orderId: string, productId: string, buyerId: string) {
        if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
            throw new Error('ID sản phẩm không hợp lệ.');
        }

        const bId = new mongoose.Types.ObjectId(buyerId);
        const pId = new mongoose.Types.ObjectId(productId);

        const orderQuery: any = { buyer_id: bId };
        if (mongoose.Types.ObjectId.isValid(orderId)) {
            orderQuery.$or = [{ _id: new mongoose.Types.ObjectId(orderId) }, { order_code: orderId }];
        } else if (orderId) {
            orderQuery.order_code = orderId;
        } else {
            throw new Error('ID đơn hàng không hợp lệ.');
        }

        const order = await Order.findOne(orderQuery).select('_id').lean();
        if (!order) return null;

        const review = await Review.findOne({
            order_id: order._id,
            product_id: pId,
            buyer_id: bId
        }).lean();

        if (!review) return null;

        return {
            id: review._id.toString(),
            orderId: review.order_id.toString(),
            productId: review.product_id.toString(),
            rating: review.rating,
            comment: review.comment || '',
            text: review.comment || '',
            images: review.images || [],
            sellerResponse: review.seller_response,
            repliedAt: review.replied_at,
            createdAt: review.created_at
        };
    }

    /**
     * Seller phản hồi đánh giá của khách hàng
     */
    static async replyReview(sellerId: string, reviewId: string, replyComment: string) {
        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            throw new Error('ID đánh giá không hợp lệ.');
        }

        const text = (replyComment || '').trim();
        if (!text) {
            throw new Error('Nội dung phản hồi không được để trống.');
        }

        const review = await Review.findById(reviewId);
        if (!review) {
            throw new Error('Không tìm thấy đánh giá.');
        }

        // Kiểm tra xem seller có phải là chủ gian hàng không
        const shop = await Shop.findById(review.shop_id).lean();
        if (!shop || shop.owner_id.toString() !== sellerId) {
            throw new Error('Bạn không có quyền phản hồi đánh giá của gian hàng này.');
        }

        review.seller_response = text;
        review.replied_at = new Date();
        await review.save();

        return {
            id: review._id.toString(),
            sellerResponse: review.seller_response,
            repliedAt: review.replied_at
        };
    }

    /**
     * Upload ảnh đính kèm cho đánh giá (hỗ trợ cả Cloudinary và lưu đĩa local)
     */
    static async uploadReviewImage(file: Express.Multer.File): Promise<string> {
        const source: Buffer | string = (file as any).buffer ?? file.path;
        const cleanupLocal = async () => {
            if (file.path) await fs.promises.unlink(file.path).catch(() => { });
        };

        try {
            const meta = await sharp(source).metadata();
            if (!meta.width || !meta.height) throw new Error('invalid image');
        } catch {
            await cleanupLocal();
            throw new Error('File tải lên không phải là định dạng hình ảnh hợp lệ.');
        }

        if (isCloudinaryEnabled()) {
            const buffer = Buffer.isBuffer(source) ? source : await fs.promises.readFile(source);
            try {
                const asset = await uploadImage(buffer, { filename: file.originalname, mimetype: file.mimetype });
                await cleanupLocal();
                return asset.url;
            } catch (err: any) {
                await cleanupLocal();
                throw new Error(`Upload Cloudinary thất bại: ${err.message}`);
            }
        }

        if (file.path) {
            return publicUrl(file.path);
        }

        throw new Error('Không thể lưu trữ hình ảnh tải lên.');
    }
}
