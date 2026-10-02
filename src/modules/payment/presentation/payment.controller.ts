import { Request, Response } from 'express';
import { VNPayService, vnpayService } from '../application/vnpay.service';
import { logger } from '../../../shared/utils/logger';

export class PaymentController {
    constructor(private readonly service: VNPayService = vnpayService) {}

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

}

export const paymentController = new PaymentController();
