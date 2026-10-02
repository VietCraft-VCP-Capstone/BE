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

// Không expose lệnh refund provider trực tiếp. Mọi hoàn tiền phải đi qua /api/refunds
// để có idempotency, phân quyền theo shop, state machine và ledger.

export { paymentRouter };
export default paymentRouter;
