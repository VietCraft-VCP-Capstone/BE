import { Request, Response } from 'express';
import { PayosService, payosService } from '../application/payos.service';
import { AuthenticatedRequest } from '../../../app/types/auth';
import { logger } from '../../../shared/utils/logger';

export class PaymentController {
    constructor(
        private readonly payos: PayosService = payosService,
    ) {}

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
