import { Router, Response } from 'express';
import { UserService } from '../application/user.service';
import { authenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

// Lấy thông tin cá nhân
router.get('/profile', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const profile = await UserService.getProfile(userId);
        res.json(profile);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Cập nhật thông tin cá nhân
router.put('/profile', authenticate, async (req: AuthenticatedRequest, res: Response) => {
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

export const userRouter = router;
export default userRouter;
