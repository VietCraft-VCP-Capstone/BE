import { Router, Response } from 'express';
import { AdminSellerKycService } from '../application/admin-seller-kyc.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

// Tất cả các route quản lý phê duyệt Seller yêu cầu quyền ADMIN
router.use(authenticate);
router.use(requireRole(['admin']));

/**
 * 1. Thống kê tổng số hồ sơ
 */
router.get('/stats', async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const stats = await AdminSellerKycService.getStats();
        res.status(200).json({ success: true, data: stats });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * 2. Danh sách hồ sơ đăng ký Người bán
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await AdminSellerKycService.listApplications(req.query as any);
        res.status(200).json({ success: true, data: result });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * 3. Chi tiết hồ sơ KYC (kèm presigned URLs xem tài liệu riêng tư)
 */
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await AdminSellerKycService.getApplicationDetail(req.params.id);
        res.status(200).json({ success: true, data: result });
    } catch (error: any) {
        res.status(404).json({ success: false, error: error.message });
    }
});

/**
 * 4. Phê duyệt hồ sơ Người bán
 */
router.post('/:id/approve', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await AdminSellerKycService.approveApplication(req.params.id, req.user!.id);
        res.status(200).json(result);
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * 5. Từ chối hồ sơ Người bán
 */
router.post('/:id/reject', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { reason } = req.body;
        const result = await AdminSellerKycService.rejectApplication(req.params.id, req.user!.id, reason);
        res.status(200).json(result);
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

export const adminSellerRouter = router;
