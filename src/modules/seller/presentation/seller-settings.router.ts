import { Router, Response } from 'express';
import { SellerSettingsService } from '../application/seller-settings.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

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

