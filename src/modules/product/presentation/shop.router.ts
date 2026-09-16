import { Router, Response } from 'express';
import { ShopService } from '../application/shop.service';
import { authenticate, requireRole, optionalAuthenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

/**
 * GET /api/shops/:id
 * Lấy thông tin chi tiết gian hàng (Public hoặc kèm auth để biết isFollowing)
 */
router.get('/:id', optionalAuthenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const shop = await ShopService.getShopDetail(req.params.id, req.user?.id);
        res.json(shop);
    } catch (error: any) {
        if (/không tìm thấy/i.test(error?.message || '')) {
            return res.status(404).json({ error: error.message });
        }
        res.status(400).json({ error: error.message || 'Lỗi khi tải thông tin gian hàng.' });
    }
});

/**
 * POST /api/shops/:id/follow
 * Người mua theo dõi gian hàng
 */
router.post('/:id/follow', authenticate, requireRole(['buyer']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const buyerId = req.user!.id;
        const result = await ShopService.followShop(req.params.id, buyerId);
        res.json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Lỗi khi theo dõi gian hàng.' });
    }
});

/**
 * DELETE /api/shops/:id/follow
 * Người mua hủy theo dõi gian hàng
 */
router.delete('/:id/follow', authenticate, requireRole(['buyer']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const buyerId = req.user!.id;
        const result = await ShopService.unfollowShop(req.params.id, buyerId);
        res.json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Lỗi khi hủy theo dõi gian hàng.' });
    }
});

export const shopRouter = router;
export default shopRouter;
