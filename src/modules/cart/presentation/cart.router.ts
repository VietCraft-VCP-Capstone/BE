import { Router } from 'express';
import { CartService } from '../application/cart.service';
import { authenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const userId = req.user!.id;
        const cart = await CartService.getCart(userId);
        res.json({ success: true, data: cart });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/items', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const userId = req.user!.id;
        const cart = await CartService.addItem(userId, req.body);
        res.status(201).json({ success: true, data: cart });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.put('/items/:itemId', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const userId = req.user!.id;
        const { quantity, isSelected } = req.body;
        let cart;
        if (typeof isSelected === 'boolean') {
            cart = await CartService.toggleSelect(userId, req.params.itemId, isSelected);
        } else {
            cart = await CartService.updateQuantity(userId, req.params.itemId, quantity);
        }
        res.json({ success: true, data: cart });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.delete('/items/:itemId', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const userId = req.user!.id;
        const cart = await CartService.removeItem(userId, req.params.itemId);
        res.json({ success: true, data: cart });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.delete('/', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const userId = req.user!.id;
        const result = await CartService.clearCart(userId);
        res.json({ success: true, data: result });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export const cartRouter = router;
export default cartRouter;
