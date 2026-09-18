import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { OrdersService } from '../application/order.service';
import { authenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';

const router = Router();


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

import { verifyPrinterWebhook } from './middlewares/verify-printer-webhook.middleware';

router.post('/webhook/provider', verifyPrinterWebhook, async (req: Request, res: Response) => {
    try {
        const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
        logger.info(`[PROVIDER WEBHOOK] Nhận payload: ${JSON.stringify(req.body)}`);
        const result = await OrdersService.handleProviderWebhook(req.body, req.headers, clientIp);
        res.json(result);
    } catch (error: any) {
        logger.error(`[PROVIDER WEBHOOK ERROR] ${error.message}`);
        res.status(400).json({ error: error.message });
    }
});

router.post('/webhook/printer', verifyPrinterWebhook, async (req: Request, res: Response) => {
    try {
        logger.info(`[PRINTER WEBHOOK] Nhận callback trạng thái: ${JSON.stringify(req.body)}`);
        const result = await OrdersService.handlePrinterStatusWebhook(req.body);
        res.json(result);
    } catch (error: any) {
        logger.error(`[PRINTER WEBHOOK ERROR] ${error.message}`);
        res.status(400).json({ error: error.message });
    }
});

router.post('/webhook/tracking', verifyPrinterWebhook, async (req: Request, res: Response) => {
    try {
        logger.info(`[TRACKING WEBHOOK] Nhận callback vận đơn: ${JSON.stringify(req.body)}`);
        const result = await OrdersService.handlePrinterTrackingWebhook(req.body);
        res.json(result);
    } catch (error: any) {
        logger.error(`[TRACKING WEBHOOK ERROR] ${error.message}`);
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
