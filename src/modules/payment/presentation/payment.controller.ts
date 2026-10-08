import { Request, Response } from 'express';
import { VNPayService, vnpayService } from '../application/vnpay.service';
import { PayosService, payosService } from '../application/payos.service';
import { AuthenticatedRequest } from '../../../app/types/auth';
import { logger } from '../../../shared/utils/logger';
import { RefundRequestService } from '../../order/application/refund-request.service';

export class PaymentController {
    constructor(
        private readonly service: VNPayService = vnpayService,
        private readonly payos: PayosService = payosService,
    ) {}

    /**
     * POST /api/payment/vnpay/create-url
     * Tạo URL thanh toán VNPay
     */
    createPaymentUrl = async (req: Request, res: Response): Promise<void> => {
        try {
            const { orderId, bankCode, returnUrl } = req.body;
            if (!orderId) {
                res.status(400).json({
                    success: false,
                    message: 'Thiếu trường bắt buộc: orderId'
                });
                return;
            }

            // Lấy Client IP chuẩn qua X-Forwarded-For hoặc Express trust proxy
            const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || '127.0.0.1';

            const paymentUrl = await this.service.createPaymentUrl({
                orderId,
                clientIp,
                bankCode,
                returnUrl
            });

            res.status(200).json({
                success: true,
                data: { paymentUrl }
            });
        } catch (error: any) {
            logger.error(`[PaymentController] createPaymentUrl error: ${error.message}`);
            res.status(400).json({
                success: false,
                message: error.message || 'Không thể tạo URL thanh toán'
            });
        }
    };

    /**
     * GET /api/payment/vnpay/ipn
     * Webhook nhận thông báo thanh toán tức thì từ server VNPay
     */
    handleIpn = async (req: Request, res: Response): Promise<void> => {
        try {
            logger.info('[PaymentController] Nhận IPN từ VNPay:', req.query);
            const result = await this.service.handleIpn(req.query);
            // Chuẩn phản hồi bắt buộc cho VNPay: { RspCode: '...', Message: '...' }
            res.status(200).json(result);
        } catch (error: any) {
            logger.error(`[PaymentController] IPN handler crash: ${error.message}`);
            res.status(200).json({ RspCode: '99', Message: 'Unknown error' });
        }
    };

    /**
     * GET /api/payment/vnpay/return
     * Endpoint xử lý khi trình duyệt người dùng redirect về sau khi thanh toán
     */
    handleReturn = async (req: Request, res: Response): Promise<void> => {
        try {
            const result = this.service.verifyReturnUrl(req.query);
            res.status(200).json({
                success: result.isSuccess,
                data: result
            });
        } catch (error: any) {
            logger.error(`[PaymentController] Return URL verification error: ${error.message}`);
            res.status(400).json({
                success: false,
                message: error.message || 'Xác thực chữ ký trả về thất bại'
            });
        }
    };

    /**
     * POST /api/payment/vnpay/refund
     * API Hoàn tiền đơn hàng VNPay
     */
    refund = async (req: Request, res: Response): Promise<void> => {
        try {
            const { refundRequestId } = req.body;
            if (!refundRequestId) {
                res.status(400).json({
                    success: false,
                    message: 'Cần refundRequestId của yêu cầu đã được duyệt.'
                });
                return;
            }

            const result = await RefundRequestService.retryExecution(refundRequestId, (req as any).user.id);

            res.status(200).json({
                success: result?.execution_status === 'SUCCEEDED',
                message: result?.execution_error || (result?.execution_status === 'SUCCEEDED' ? 'Cổng thanh toán đã xác nhận hoàn tiền.' : 'Yêu cầu đang chờ thực thi hoặc xác minh.'),
                data: result
            });
        } catch (error: any) {
            logger.error(`[PaymentController] Refund error: ${error.message}`);
            res.status(400).json({
                success: false,
                message: error.message || 'Không thể xử lý yêu cầu hoàn tiền'
            });
        }
    };

    /**
     * POST /api/payment/payos/create
     * Tạo link thanh toán payOS cho đơn của chính người mua
     */
    createPayosPayment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { orderId } = req.body;
            if (!orderId) {
                res.status(400).json({ success: false, message: 'Thiếu trường bắt buộc: orderId' });
                return;
            }
            const result = await this.payos.createPayment({ orderId, buyerId: req.user?.id });
            res.status(200).json({ success: true, data: result });
        } catch (error: any) {
            logger.error(`[PaymentController] createPayosPayment error: ${error.message}`);
            res.status(400).json({ success: false, message: error.message || 'Không thể tạo thanh toán payOS' });
        }
    };

    /**
     * POST /api/payment/payos/sync
     * Đối soát trạng thái thanh toán của đơn với payOS cho chính người mua
     */
    syncPayosPayment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { orderId } = req.body;
            if (!orderId) {
                res.status(400).json({ success: false, message: 'Thiếu trường bắt buộc: orderId' });
                return;
            }
            const result = await this.payos.syncPayment({ orderId, buyerId: req.user?.id });
            res.status(200).json({ success: true, data: result });
        } catch (error: any) {
            logger.error(`[PaymentController] syncPayosPayment error: ${error.message}`);
            res.status(400).json({ success: false, message: error.message || 'Không thể kiểm tra thanh toán payOS' });
        }
    };

    /**
     * POST /api/payment/payos/webhook
     * 200 khi đã ghi nhận (kể cả webhook thử/đơn lạ); 400 khi chữ ký sai; 500 để payOS gửi lại.
     */
    handlePayosWebhook = async (req: Request, res: Response): Promise<void> => {
        try {
            const outcome = await this.payos.handleWebhook(req.body);
            res.status(outcome === 'INVALID_SIGNATURE' ? 400 : 200).json({ success: outcome !== 'INVALID_SIGNATURE' });
        } catch (error: any) {
            logger.error(`[PaymentController] payOS webhook handler crash: ${error.message}`);
            res.status(500).json({ success: false });
        }
    };

}

export const paymentController = new PaymentController();
