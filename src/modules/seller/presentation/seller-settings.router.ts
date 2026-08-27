import { Router, Response } from 'express';
import { SellerSettingsService } from '../application/seller-settings.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

// Cài đặt gian hàng luôn thuộc về chính người đang đăng nhập.
// sellerId BẮT BUỘC lấy từ token (req.user.id): nếu nhận từ query/body thì bất kỳ ai
// cũng đọc/ghi đè được settings gian hàng của người khác.
// GET cài đặt gian hàng của seller đang đăng nhập
router.get('/', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const settings = await SellerSettingsService.getSettings(req.user!.id);
        res.json(settings);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải cài đặt gian hàng.' });
    }
});

// PUT cập nhật cài đặt gian hàng của seller đang đăng nhập
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
