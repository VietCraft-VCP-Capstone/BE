import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { ReviewService } from '../application/review.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { isCloudinaryEnabled } from '../../../infrastructure/storage/cloudinary.service';
import { UPLOAD_ROOT } from '../../../shared/upload/upload.middleware';

const router = Router();

// Cấu hình thư mục lưu trữ ảnh review cục bộ (fallback khi chưa bật Cloudinary)
const REVIEW_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'reviews');
const ALLOWED_MIME = new Map<string, string>([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/webp', '.webp'],
]);

const diskStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, REVIEW_UPLOAD_DIR),
    filename: (_req, file, cb) => {
        const ext = ALLOWED_MIME.get(file.mimetype) || '.jpg';
        cb(null, `review-${crypto.randomUUID()}${ext}`);
    }
});

const uploadMiddleware = multer({
    storage: isCloudinaryEnabled() ? multer.memoryStorage() : diskStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.has(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Chỉ chấp nhận định dạng ảnh PNG, JPG hoặc WebP.'));
        }
    }
});

// Middleware bọc bắt lỗi Multer
function handleMulterUpload(req: Request, res: Response, next: NextFunction) {
    uploadMiddleware.single('file')(req, res, (err: any) => {
        if (err) {
            return res.status(400).json({ error: err.message === 'File too large' ? 'Dung lượng ảnh vượt quá 10MB.' : err.message });
        }
        next();
    });
}

/**
 * POST /api/reviews/upload
 * Upload ảnh đính kèm cho bài đánh giá
 */
router.post(['/upload', '/upload-image'], authenticate, requireRole(['buyer']), handleMulterUpload, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Vui lòng chọn file hình ảnh.' });
        }
        const url = await ReviewService.uploadReviewImage(req.file);
        res.status(201).json({ url });
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Lỗi khi tải ảnh lên.' });
    }
});

/**
 * POST /api/reviews
 * Buyer tạo mới đánh giá cho sản phẩm trong đơn hàng đã giao
 */
router.post('/', authenticate, requireRole(['buyer']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const buyerId = req.user!.id;
        const review = await ReviewService.createReview(buyerId, req.body);
        res.status(201).json({
            success: true,
            message: 'Đánh giá sản phẩm thành công.',
            data: review
        });
    } catch (error: any) {
        const msg = error.message || '';
        if (msg.includes('không có quyền') || msg.includes('chỉ có thể đánh giá sau khi đơn hàng đã được giao')) {
            return res.status(403).json({ error: msg });
        }
        if (msg.includes('đã gửi đánh giá') || error.code === 11000) {
            return res.status(409).json({ error: 'Bạn đã đánh giá sản phẩm này cho đơn hàng hiện tại rồi.' });
        }
        res.status(400).json({ error: msg });
    }
});

/**
 * GET /api/reviews/product/:productId
 * Xem danh sách đánh giá tại trang chi tiết sản phẩm (Public)
 */
router.get('/product/:productId', async (req: Request, res: Response) => {
    try {
        const { page, limit, rating } = req.query;
        const result = await ReviewService.getProductReviews(req.params.productId, {
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
            rating: rating ? Number(rating) : undefined,
        });
        res.json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/reviews/order/:orderId/product/:productId
 * Kiểm tra xem Buyer đã đánh giá sản phẩm này trong đơn hàng chưa
 */
router.get('/order/:orderId/product/:productId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const buyerId = req.user!.id;
        const review = await ReviewService.getOrderProductReview(req.params.orderId, req.params.productId, buyerId);
        res.json({
            hasReviewed: Boolean(review),
            review
        });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/reviews/:reviewId/reply
 * Seller phản hồi đánh giá của khách hàng
 */
router.post('/:reviewId/reply', authenticate, requireRole(['seller']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const sellerId = req.user!.id;
        const result = await ReviewService.replyReview(sellerId, req.params.reviewId, req.body?.comment);
        res.json({
            success: true,
            message: 'Phản hồi đánh giá thành công.',
            data: result
        });
    } catch (error: any) {
        if (error.message.includes('không có quyền')) {
            return res.status(403).json({ error: error.message });
        }
        res.status(400).json({ error: error.message });
    }
});

export const reviewRouter = router;
export default reviewRouter;
