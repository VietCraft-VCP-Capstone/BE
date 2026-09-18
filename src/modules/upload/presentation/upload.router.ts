import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { UploadService } from '../application/upload.service';
import { authenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { logger } from '../../../shared/utils/logger';

const router = Router();

// Whitelist MIME types
const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml',
]);

const ALLOWED_FOLDERS = new Set([
    'avatars',
    'shops',
    'designs',
    'products',
    'general',
    'mockups',
]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
        files: 10,
    },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Chỉ chấp nhận các định dạng ảnh hợp lệ (PNG, JPG, JPEG, WebP, GIF, SVG).'));
        }
    },
});

// Middleware bọc bắt lỗi Multer
const handleMulterError = (multerMiddleware: any) => {
    return (req: Request, res: Response, next: NextFunction) => {
        multerMiddleware(req, res, (err: any) => {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: 'Kích thước tệp vượt quá giới hạn cho phép (tối đa 10MB).' });
                }
                return res.status(400).json({ error: `Lỗi tải tệp: ${err.message}` });
            }
            if (err) {
                return res.status(400).json({ error: err.message || 'Lỗi xử lý tệp tin.' });
            }
            next();
        });
    };
};

/**
 * POST /api/upload/image
 * Tải lên 1 ảnh đơn (chung cho logo, banner, sản phẩm, thiết kế)
 */
router.post(
    '/image',
    handleMulterError(upload.single('file')),
    async (req: Request, res: Response) => {
        try {
            const file = req.file;
            if (!file) {
                return res.status(400).json({ error: 'Vui lòng chọn tệp ảnh để tải lên (field: "file").' });
            }

            const rawFolder = (req.query.folder as string) || (req.body.folder as string) || 'general';
            const folder = ALLOWED_FOLDERS.has(rawFolder) ? rawFolder : 'general';

            const result = await UploadService.uploadSingle(file, { folder });
            return res.status(200).json({
                success: true,
                ...result,
            });
        } catch (error: any) {
            logger.error('Lỗi khi tải ảnh: ' + error.message);
            return res.status(400).json({ error: error.message || 'Tải ảnh thất bại.' });
        }
    }
);

/**
 * POST /api/upload/avatar
 * Tải lên ảnh đại diện cá nhân (tự động căn vuông, nhận diện khuôn mặt)
 */
router.post(
    '/avatar',
    handleMulterError(upload.single('file')),
    async (req: Request, res: Response) => {
        try {
            const file = req.file;
            if (!file) {
                return res.status(400).json({ error: 'Vui lòng chọn tệp ảnh đại diện (field: "file").' });
            }

            const result = await UploadService.uploadSingle(file, { folder: 'avatars', isAvatar: true });
            return res.status(200).json({
                success: true,
                ...result,
            });
        } catch (error: any) {
            logger.error('Lỗi khi tải avatar: ' + error.message);
            return res.status(400).json({ error: error.message || 'Tải ảnh đại diện thất bại.' });
        }
    }
);

/**
 * POST /api/upload/multiple
 * Tải lên nhiều ảnh cùng lúc (tối đa 10 ảnh)
 */
router.post(
    '/multiple',
    handleMulterError(upload.array('files', 10)),
    async (req: Request, res: Response) => {
        try {
            const files = req.files as Express.Multer.File[];
            if (!files || files.length === 0) {
                return res.status(400).json({ error: 'Vui lòng chọn ít nhất 1 tệp ảnh để tải lên.' });
            }

            const rawFolder = (req.query.folder as string) || (req.body.folder as string) || 'products';
            const folder = ALLOWED_FOLDERS.has(rawFolder) ? rawFolder : 'products';

            const results = await Promise.all(
                files.map(file => UploadService.uploadSingle(file, { folder }))
            );

            return res.status(200).json({
                success: true,
                count: results.length,
                images: results,
            });
        } catch (error: any) {
            logger.error('Lỗi khi tải nhiều ảnh: ' + error.message);
            return res.status(400).json({ error: error.message || 'Tải nhiều ảnh thất bại.' });
        }
    }
);

/**
 * DELETE /api/upload
 * Xóa ảnh trên Cloudinary hoặc local (yêu cầu đăng nhập)
 */
router.delete(
    '/',
    authenticate,
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const { publicId, url } = req.body || {};
            const target = publicId || url || (req.query.publicId as string) || (req.query.url as string);

            if (!target) {
                return res.status(400).json({ error: 'Vui lòng cung cấp publicId hoặc URL của ảnh cần xóa.' });
            }

            const result = await UploadService.deleteResource(target);
            return res.status(200).json(result);
        } catch (error: any) {
            return res.status(400).json({ error: error.message || 'Xóa ảnh thất bại.' });
        }
    }
);

export const uploadRouter = router;
export default uploadRouter;
