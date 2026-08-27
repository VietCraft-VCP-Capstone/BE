import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { OrdersService } from '../application/order.service';
import { authenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';

const router = Router();

/**
 * Webhook cổng thanh toán không có JWT nên phải xác thực bằng shared secret
 * (header `x-payment-callback-secret`, khớp PAYMENT_CALLBACK_SECRET).
 * Chưa cấu hình: dev chỉ cảnh báo, production chặn thẳng.
 */
function verifyPaymentCallback(req: Request, res: Response, next: NextFunction) {
    const expected = config.paymentCallbackSecret;
    if (!expected) {
        if (config.nodeEnv === 'production') {
            logger.error('PAYMENT_CALLBACK_SECRET chưa cấu hình — từ chối callback thanh toán.');
            return res.status(503).json({ error: 'Payment callback chưa được cấu hình' });
        }
        logger.warn('PAYMENT_CALLBACK_SECRET chưa cấu hình — callback thanh toán đang KHÔNG được xác thực (chỉ chấp nhận ở development).');
        return next();
    }

    const provided = String(req.headers['x-payment-callback-secret'] || '');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ error: 'Unauthorized: Invalid payment callback secret' });
    }
    next();
}

router.post('/', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const buyerId = req.user!.id;
        const order = await OrdersService.createOrder(buyerId, req.body);
        res.status(201).json(order);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const buyerId = req.user!.id;
        const status = req.query.status as string;
        const orders = await OrdersService.getOrdersByBuyer(buyerId, status);
        res.json(orders);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
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

router.post('/callback/:id', verifyPaymentCallback, async (req, res) => {
    try {
        const { status } = req.body;
        const result = await OrdersService.processPaymentCallback(req.params.id, status);
        res.json({ message: 'Callback handled successfully', result });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

export const ordersRouter = router;
export const orderRouter = router;
export default ordersRouter;
