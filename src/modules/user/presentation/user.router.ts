import { Router, Response } from 'express';
import { UserService } from '../application/user.service';
import { WishlistService } from '../../product/application/wishlist.service';
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
router.post('/profile/addresses', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const addresses = await UserService.addAddress(userId, req.body);
        res.status(201).json(addresses);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Sửa địa chỉ
router.put('/profile/addresses/:addressId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
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
router.delete('/profile/addresses/:addressId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { addressId } = req.params;
        const addresses = await UserService.deleteAddress(userId, addressId);
        res.json(addresses);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// ---------------------------------------------------------------------------
// Wishlist: ủy quyền hoàn toàn cho WishlistService (collection `wishlists`).
// Trước đây route này đọc/ghi mảng `users.wishlist` nên /users/wishlist và
// /favorites lưu ở hai nơi khác nhau và không bao giờ đồng bộ.
// Giữ nguyên shape FE đang dùng: mảng product id (string[]).
// ---------------------------------------------------------------------------

// GET /users/wishlist - danh sách product id đang yêu thích
router.get('/wishlist', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const ids = await WishlistService.getProductIds(req.user!.id);
        res.json(ids);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /users/wishlist/:productId - thêm, trả về mảng id sau khi thêm
router.post('/wishlist/:productId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        await WishlistService.addFavorite(req.user!.id, req.params.productId);
        const ids = await WishlistService.getProductIds(req.user!.id);
        res.json(ids);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// DELETE /users/wishlist/:productId - xoá, trả về mảng id sau khi xoá
router.delete('/wishlist/:productId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        await WishlistService.removeFavorite(req.user!.id, req.params.productId);
        const ids = await WishlistService.getProductIds(req.user!.id);
        res.json(ids);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

export const userRouter = router;
export default userRouter;
