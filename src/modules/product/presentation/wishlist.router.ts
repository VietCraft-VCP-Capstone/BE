import { Router } from 'express';
import { WishlistService } from '../application/wishlist.service';
import { authenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const userId = req.user!.id;
        const wishlist = await WishlistService.getWishlist(userId);
        res.json({ success: true, data: wishlist });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/toggle', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const userId = req.user!.id;
        const { productId } = req.body;
        const result = await WishlistService.toggleFavorite(userId, productId);
        res.status(200).json({ success: true, ...result });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/:productId', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const userId = req.user!.id;
        const { productId } = req.params;
        const result = await WishlistService.toggleFavorite(userId, productId);
        res.status(200).json({ success: true, ...result });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.delete('/:productId', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const userId = req.user!.id;
        const { productId } = req.params;
        const wishlist = await WishlistService.removeFavorite(userId, productId);
        res.json({ success: true, data: wishlist });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

export const wishlistRouter = router;
export default wishlistRouter;
