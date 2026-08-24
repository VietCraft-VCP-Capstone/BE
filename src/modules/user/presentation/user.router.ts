import { Router, Response } from 'express';
import { UserService } from '../application/user.service';
import { User } from '../infrastructure/models/user.model';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

// Lấy thông tin cá nhân
router.get('/profile', authenticate, requireRole(['buyer', 'seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const profile = await UserService.getProfile(userId);
        res.json(profile);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Cập nhật thông tin cá nhân
router.put('/profile', authenticate, requireRole(['buyer', 'seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const profile = await UserService.updateProfile(userId, req.body);
        res.json(profile);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Thêm địa chỉ mới
router.post('/profile/addresses', authenticate, requireRole(['buyer', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const addresses = await UserService.addAddress(userId, req.body);
        res.status(201).json(addresses);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Sửa địa chỉ
router.put('/profile/addresses/:addressId', authenticate, requireRole(['buyer', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { addressId } = req.params;
        const addresses = await UserService.updateAddress(userId, addressId, req.body);
        res.json(addresses);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Xóa địa chỉ
router.delete('/profile/addresses/:addressId', authenticate, requireRole(['buyer', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { addressId } = req.params;
        const addresses = await UserService.deleteAddress(userId, addressId);
        res.json(addresses);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// GET /wishlist - get current user's wishlist product IDs
router.get('/wishlist', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = await User.findById(req.user!.id).select('wishlist');
        if (!user) { res.status(404).json({ error: 'User not found' }); return; }
        res.json(user.wishlist || []);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /wishlist/:productId - add a product to wishlist
router.post('/wishlist/:productId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = await User.findById(req.user!.id);
        if (!user) { res.status(404).json({ error: 'User not found' }); return; }

        const { productId } = req.params;
        const alreadyIn = user.wishlist.some((id: any) => id.toString() === productId);
        if (!alreadyIn) {
            user.wishlist.push(productId as any);
            await user.save();
        }
        res.json(user.wishlist);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// DELETE /wishlist/:productId - remove a product from wishlist
router.delete('/wishlist/:productId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = await User.findById(req.user!.id);
        if (!user) { res.status(404).json({ error: 'User not found' }); return; }

        const { productId } = req.params;
        user.wishlist = user.wishlist.filter((id: any) => id.toString() !== productId) as any;
        await user.save();
        res.json(user.wishlist);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

export const userRouter = router;
export default userRouter;
