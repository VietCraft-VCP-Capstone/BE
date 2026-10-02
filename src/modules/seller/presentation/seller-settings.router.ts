import { Router, Response } from 'express';
import { SellerSettingsService } from '../application/seller-settings.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { CommissionSetting } from '../../../shared/services/commission-setting.service';

const router = Router();

/**
 * % hoa hồng áp cho một sản phẩm cụ thể — chỉ đọc.
 *
 * Form tạo sản phẩm gọi kèm `categoryId` và `productType` để hiện đúng mức sẽ bị áp, bằng
 * đúng con số BE sẽ dùng khi lưu giá. Không truyền gì thì trả mức mặc định của sàn.
 * Đổi mức là việc của admin.
 */
router.get('/commission', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : null;
        const productType = typeof req.query.productType === 'string' ? req.query.productType : null;
        res.json({ percent: await CommissionSetting.resolvePercent(categoryId, productType) });
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải % hoa hồng sàn.' });
    }
});

router.get('/', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const settings = await SellerSettingsService.getSettings(req.user!.id);
        res.json(settings);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải cài đặt gian hàng.' });
    }
});

router.put('/', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const updated = await SellerSettingsService.updateSettings(req.user!.id, req.body);
        res.json(updated);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Lỗi khi lưu cài đặt gian hàng.' });
    }
});

export const sellerSettingsRouter = router;
export default router;

