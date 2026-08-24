import { Router } from 'express';
import { SellerSettingsService } from '../application/seller-settings.service';
import { optionalAuthenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

// GET seller settings for authenticated seller
router.get('/', optionalAuthenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const sellerId = req.user?.id || (req.query.sellerId as string) || '6a89d3441809bf8480ee0ba1';
        const settings = await SellerSettingsService.getSettings(sellerId);
        res.json(settings);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải cài đặt gian hàng.' });
    }
});

// PUT update seller settings
router.put('/', optionalAuthenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const sellerId = req.user?.id || (req.body.sellerId as string) || '6a89d3441809bf8480ee0ba1';
        const updated = await SellerSettingsService.updateSettings(sellerId, req.body);
        res.json(updated);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Lỗi khi lưu cài đặt gian hàng.' });
    }
});

export default router;
