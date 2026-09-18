import { Router, Response, NextFunction } from 'express';
import { adminService } from '../application/admin.service';
import { parsePageParams } from '../../../shared/utils/pagination';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

// Tất cả các route admin yêu cầu xác thực và quyền ADMIN
router.use(authenticate);
router.use(requireRole(['admin']));

// ==========================================
// 1. PRODUCT MODERATION
// ==========================================

router.get('/moderation/products', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const params = parsePageParams(req.query as Record<string, unknown>);
        const status = req.query.status as string | undefined;
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

// ==========================================
// 2. SELLER APPLICATION & KYC MANAGEMENT
// ==========================================

/**
 * Thống kê tổng số hồ sơ người bán
 */
router.get('/seller-applications/stats', async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const stats = await adminService.getSellerApplicationStats();
        res.status(200).json({ success: true, data: stats });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * Danh sách hồ sơ đăng ký Người bán (lọc & phân trang)
 */
router.get('/seller-applications', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await adminService.listSellerApplications(req.query as any);
        res.status(200).json({ success: true, data: result });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * Chi tiết hồ sơ KYC người bán (kèm presigned URLs)
 */
router.get('/seller-applications/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await adminService.getSellerApplicationDetail(req.params.id);
        res.status(200).json({ success: true, data: result });
    } catch (error: any) {
        res.status(404).json({ success: false, error: error.message });
    }
});

/**
 * Phê duyệt hồ sơ Người bán
 */
router.post('/seller-applications/:id/approve', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await adminService.approveSellerApplication(req.params.id, req.user!.id);
        res.status(200).json(result);
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * Từ chối hồ sơ Người bán
 */
router.post('/seller-applications/:id/reject', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { reason } = req.body;
        const result = await adminService.rejectSellerApplication(req.params.id, req.user!.id, reason);
        res.status(200).json(result);
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

export { router as adminRouter };
