import { Router, Response } from 'express';
import { User } from '../infrastructure/models/user.model';
import { Order } from '../../order/infrastructure/models/order.model';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

// GET /profile
router.get('/profile', authenticate, requireRole(['buyer', 'seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const user = await User.findById(userId);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        // Count real orders for progress metric
        const ordersCount = await Order.countDocuments({ buyer_id: user._id });

        res.json({
            _id: user._id,
            email: user.email,
            full_name: user.full_name,
            phone: user.phone,
            avatar: user.avatar,
            addresses: user.addresses || [],
            notification_settings: user.notification_settings || { in_app: true, push: true, email: true },
            rank: 'Thành viên Bạc',
            stats: {
                ordersCount: ordersCount || 0,
                collectionsCount: 5,
                followingCount: 24
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /profile
router.put('/profile', authenticate, requireRole(['buyer', 'seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { full_name, phone, avatar, notification_settings } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        if (full_name !== undefined) user.full_name = full_name;
        if (phone !== undefined) user.phone = phone;
        if (avatar !== undefined) user.avatar = avatar;
        if (notification_settings !== undefined) user.notification_settings = notification_settings;

        await user.save();

        res.json({
            _id: user._id,
            email: user.email,
            full_name: user.full_name,
            phone: user.phone,
            avatar: user.avatar,
            addresses: user.addresses || [],
            notification_settings: user.notification_settings
        });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// POST /profile/addresses
router.post('/profile/addresses', authenticate, requireRole(['buyer', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const user = await User.findById(userId);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const newAddress = req.body;
        if (newAddress.is_default) {
            user.addresses.forEach((addr: any) => { addr.is_default = false; });
        }

        user.addresses.push(newAddress);
        await user.save();

        res.status(201).json(user.addresses);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// PUT /profile/addresses/:addressId
router.put('/profile/addresses/:addressId', authenticate, requireRole(['buyer', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { addressId } = req.params;
        const user = await User.findById(userId);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const updateData = req.body;
        const address = user.addresses.find((addr: any) => addr._id?.toString() === addressId);
        if (!address) {
            res.status(404).json({ error: 'Address not found' });
            return;
        }

        if (updateData.is_default) {
            user.addresses.forEach((addr: any) => {
                if (addr._id?.toString() !== addressId) {
                    addr.is_default = false;
                }
            });
        }

        Object.assign(address, updateData);
        await user.save();

        res.json(user.addresses);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// DELETE /profile/addresses/:addressId
router.delete('/profile/addresses/:addressId', authenticate, requireRole(['buyer', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { addressId } = req.params;
        const user = await User.findById(userId);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const addressIndex = user.addresses.findIndex((addr: any) => addr._id?.toString() === addressId);
        if (addressIndex === -1) {
            res.status(404).json({ error: 'Address not found' });
            return;
        }

        user.addresses.splice(addressIndex, 1);
        await user.save();

        res.json(user.addresses);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

export const userRouter = router;
export default userRouter;
