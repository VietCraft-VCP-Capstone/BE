import { Router, Response } from 'express';
import { WishlistService } from '../application/wishlist.service';
import { authenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const wishlist = await WishlistService.getWishlist(req.user!.id);
        res.json({ success: true, data: wishlist });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/toggle', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { productId } = req.body || {};
        if (!productId) { res.status(400).json({ success: false, error: 'Thiếu productId.' }); return; }
        const result = await WishlistService.toggleFavorite(req.user!.id, productId);
        res.status(200).json({ success: true, ...result });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/:productId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const wishlist = await WishlistService.addFavorite(req.user!.id, req.params.productId);
        res.status(200).json({ success: true, data: wishlist });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.delete('/:productId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const wishlist = await WishlistService.removeFavorite(req.user!.id, req.params.productId);
        res.json({ success: true, data: wishlist });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

export const wishlistRouter = router;
export default wishlistRouter;

