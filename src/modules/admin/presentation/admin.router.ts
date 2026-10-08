import { Router, Response, NextFunction } from 'express';
import { adminService } from '../application/admin.service';
import { parsePageParams } from '../../../shared/utils/pagination';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { CommissionSetting } from '../../../shared/services/commission-setting.service';

const router = Router();

/**
 * Lỗi do admin nhập sai (thông điệp tiếng Việt do service ném ra) trả 400 kèm nguyên văn để
 * hiện thẳng lên form; lỗi còn lại đẩy sang error handler chung, không lộ chi tiết nội bộ.
 */
function badRequestOrNext(error: any, res: Response, next: NextFunction) {
    const known = [
        'Phần trăm hoa hồng',
        'Danh mục không hợp lệ',
        'Loại sản phẩm không hợp lệ',
        'Luật phải giới hạn',
        'Đã có luật',
        'Luật không tồn tại',
        'Tối đa',
    ];
    if (known.some(k => error?.message?.startsWith(k))) {
        return res.status(400).json({ success: false, error: error.message });
    }
    return next(error);
}

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

// ==========================================
// 3. CẤU HÌNH SÀN — % HOA HỒNG
// ==========================================

/**
 * Toàn bộ dữ liệu trang cấu hình: mức đang áp dụng, lịch sử đổi, và số liệu để ước lượng
 * tác động. Gộp một lượt gọi vì ba phần luôn hiện cùng nhau trên một màn.
 */
router.get('/settings/commission', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        res.json({ success: true, data: await adminService.getCommissionOverview() });
    } catch (error: any) {
        next(error);
    }
});

/**
 * Đặt mức MẶC ĐỊNH của sàn. Chỉ ảnh hưởng sản phẩm tạo/sửa giá và đơn phát sinh từ lúc này;
 * giá đã niêm yết không tự tính lại.
 */
router.put('/settings/commission', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const percent = await CommissionSetting.setPercent(req.body?.percent, req.user!.id);
        res.json({ success: true, data: { percent }, message: `Đã đặt mức mặc định ${percent}%` });
    } catch (error: any) {
        return badRequestOrNext(error, res, next);
    }
});

/** Thêm luật mới, hoặc sửa luật có sẵn khi body kèm `id`. */
router.put('/settings/commission/rules', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const rule = await CommissionSetting.saveRule(req.body || {}, req.user!.id);
        res.json({ success: true, data: rule, message: `Đã lưu luật ${rule.percent}%` });
    } catch (error: any) {
        return badRequestOrNext(error, res, next);
    }
});

router.delete('/settings/commission/rules/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        await CommissionSetting.deleteRule(req.params.id, req.user!.id);
        res.json({ success: true, message: 'Đã xoá luật' });
    } catch (error: any) {
        return badRequestOrNext(error, res, next);
    }
});

// ==========================================
// 4. THỐNG KÊ THU NHẬP SÀN
// ==========================================

/**
 * Số liệu tài chính của sàn trong N ngày gần nhất (mặc định 30 — BR-114).
 * Chỉ tính đơn đã thanh toán (BR-141), tối đa 365 ngày (BR-118).
 */
router.get('/finance/overview', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const days = Number(req.query.days) || 30;
        res.json({ success: true, data: await adminService.getFinanceOverview(days) });
    } catch (error: any) {
        next(error);
    }
});

export { router as adminRouter };
