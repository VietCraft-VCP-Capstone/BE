import { Router } from 'express';
import { paymentController } from './payment.controller';
import { authenticate } from '../../../app/middleware/auth.middleware';

const paymentRouter = Router();

// 1. Tạo URL thanh toán VNPay (Cần đăng nhập)
paymentRouter.post('/vnpay/create-url', authenticate, paymentController.createPaymentUrl);

// 2. Webhook IPN từ VNPay Server (Public - VNPay gọi trực tiếp bằng GET)
paymentRouter.get('/vnpay/ipn', paymentController.handleIpn);

// 3. Xử lý khi người dùng redirect về từ VNPay (Public)
paymentRouter.get('/vnpay/return', paymentController.handleReturn);

// 4. API Hoàn tiền qua VNPay (Cần quyền đăng nhập/Admin)
paymentRouter.post('/vnpay/refund', authenticate, paymentController.refund);

export { paymentRouter };
export default paymentRouter;
