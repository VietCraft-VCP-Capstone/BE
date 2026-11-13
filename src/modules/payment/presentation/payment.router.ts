import { Router } from 'express';
import { paymentController } from './payment.controller';
import { authenticate, requireRole } from '../../../app/middleware/auth.middleware';

const paymentRouter = Router();

// 1. payOS: tạo link thanh toán (Cần đăng nhập)
paymentRouter.post('/payos/create', authenticate, paymentController.createPayosPayment);

// 2. Hỏi lại payOS trạng thái thanh toán của đơn (khi webhook chưa tới)
paymentRouter.post('/payos/sync', authenticate, paymentController.syncPayosPayment);

// 3. Webhook payOS (Public - payOS gọi POST JSON, chữ ký được verify trong service)
paymentRouter.post('/payos/webhook', paymentController.handlePayosWebhook);

export { paymentRouter };
export default paymentRouter;
