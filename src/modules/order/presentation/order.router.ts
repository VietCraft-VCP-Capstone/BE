import { Router } from 'express';
import { OrdersService } from '../application/order.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

router.post('/', authenticate, requireRole(['buyer', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        const buyerId = req.user!.id;
        const order = await OrdersService.createOrder(buyerId, req.body);
        res.status(201).json(order);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/:id', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const buyerId = req.user!.id;
        const order = await OrdersService.getOrder(req.params.id, buyerId);
        res.json(order);
    } catch (error: any) {
        res.status(404).json({ error: error.message });
    }
});

router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const buyerId = req.user!.id;
        const orders = await OrdersService.getOrdersByBuyer(buyerId);
        res.json(orders);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/callback/:id', async (req, res) => {
    try {
        const { status } = req.body;
        const result = await OrdersService.processPaymentCallback(req.params.id, status);
        res.json({ message: 'Callback handled successfully', result });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

export const ordersRouter = router;
export default ordersRouter;
