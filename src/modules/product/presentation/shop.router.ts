import { Router, Response } from 'express';
import { FollowLimitError, ShopService } from '../application/shop.service';
import { authenticate, requireRole, optionalAuthenticate, normalizeRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

/**
 * GET /api/shops/following/me
 * Lấy danh sách các gian hàng mà người dùng (Buyer/Seller) đang theo dõi
 */
router.get('/following/me', authenticate, requireRole(['buyer', 'seller']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const shops = await ShopService.getFollowedShops(userId);
        res.json(shops);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Lỗi khi lấy danh sách gian hàng đang theo dõi.' });
    }
});

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
 * Người mua hoặc người bán (competitor benchmarking) theo dõi gian hàng
 */
router.post('/:id/follow', authenticate, requireRole(['buyer', 'seller']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        // Người bán theo dõi gian hàng = theo dõi đối thủ, dùng chung danh sách với khu Phân tích (BR-201).
        if (normalizeRole(req.user!.role) === 'seller') {
            await ShopService.assertSellerFollowSlot(req.params.id, userId);
        }
        const result = await ShopService.followShop(req.params.id, userId);
        res.json(result);
    } catch (error: any) {
        if (error instanceof FollowLimitError) {
            return res.status(400).json({ error: error.message, code: error.code, limit: error.limit });
        }
        res.status(400).json({ error: error.message || 'Lỗi khi theo dõi gian hàng.' });
    }
});

/**
 * DELETE /api/shops/:id/follow
 * Người mua hoặc người bán hủy theo dõi gian hàng
 */
router.delete('/:id/follow', authenticate, requireRole(['buyer', 'seller']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const result = await ShopService.unfollowShop(req.params.id, userId);
        res.json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Lỗi khi hủy theo dõi gian hàng.' });
    }
});

export const shopRouter = router;
export default shopRouter;
