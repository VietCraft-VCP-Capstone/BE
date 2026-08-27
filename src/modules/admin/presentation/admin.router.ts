import { Router, Response, NextFunction } from 'express';
import { adminService } from '../application/admin.service';
import { parsePageParams } from '../../../shared/utils/pagination';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

// All routes require authentication + admin role
router.use(authenticate);
router.use(requireRole(['admin']));

// ==================== MODERATION ====================

router.get('/moderation/products', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const params = parsePageParams(req.query as Record<string, unknown>);
        const status = req.query.status as string | undefined; // PUBLISHED | UNPUBLISHED | DRAFT | undefined(all)
        const result = await adminService.listProducts(status, params);
        res.json({ success: true, data: result });
    } catch (err: any) {
        next(err);
    }
});

router.post('/moderation/:id/unpublish', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const product = await adminService.unpublishProduct(req.params.id, req.user!.id, req.body.reason);
        if (!product) return res.status(404).json({ success: false, error: 'Sản phẩm không tồn tại' });
        res.json({ success: true, data: product, message: 'Đã gỡ sản phẩm khỏi marketplace' });
    } catch (err: any) {
        if (err.message === 'Product not found') return res.status(404).json({ success: false, error: 'Sản phẩm không tồn tại' });
        next(err);
    }
});

router.post('/moderation/:id/republish', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const result = await adminService.republishProduct(req.params.id, req.user!.id, req.body.notes);
        if (!result) return res.status(404).json({ success: false, error: 'Sản phẩm không tồn tại' });
        // warnings KHÔNG phải lỗi: sản phẩm đã được khôi phục thành công, đây chỉ
        // là danh sách chỗ tin đăng còn thiếu để admin nhắc người bán bổ sung.
        res.json({ success: true, data: result.product, warnings: result.warnings, message: 'Đã khôi phục sản phẩm' });
    } catch (err: any) {
        if (err.message === 'Product not found') return res.status(404).json({ success: false, error: 'Sản phẩm không tồn tại' });
        next(err);
    }
});

router.get('/moderation/:id/history', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const history = await adminService.getModerationHistory(req.params.id);
        res.json({ success: true, data: history });
    } catch (err: any) {
        next(err);
    }
});

router.get('/moderation/stats', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const stats = await adminService.getModerationStats();
        res.json({ success: true, data: stats });
    } catch (err: any) {
        next(err);
    }
});

export { router as adminRouter };
