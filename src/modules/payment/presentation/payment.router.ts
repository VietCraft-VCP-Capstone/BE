import { Router } from 'express';
import { paymentController } from './payment.controller';
import { authenticate, requireRole } from '../../../app/middleware/auth.middleware';

const paymentRouter = Router();

// 1. Tạo URL thanh toán VNPay (Cần đăng nhập)
paymentRouter.post('/vnpay/create-url', authenticate, paymentController.createPaymentUrl);

// 2. Webhook IPN từ VNPay Server (Public - VNPay gọi trực tiếp bằng GET)
paymentRouter.get('/vnpay/ipn', paymentController.handleIpn);

// 3. Xử lý khi người dùng redirect về từ VNPay (Public)
paymentRouter.get('/vnpay/return', paymentController.handleReturn);

// 4. API Hoàn tiền qua VNPay (Cần quyền đăng nhập/Admin)
paymentRouter.post('/vnpay/refund', authenticate, requireRole(['admin']), paymentController.refund);

// 5. payOS: tạo link thanh toán (Cần đăng nhập)
paymentRouter.post('/payos/create', authenticate, paymentController.createPayosPayment);

// 6. Hỏi lại payOS trạng thái thanh toán của đơn (khi webhook chưa tới)
paymentRouter.post('/payos/sync', authenticate, paymentController.syncPayosPayment);

// 7. Webhook payOS (Public - payOS gọi POST JSON, chữ ký được verify trong service)
paymentRouter.post('/payos/webhook', paymentController.handlePayosWebhook);

export { paymentRouter };
export default paymentRouter;
