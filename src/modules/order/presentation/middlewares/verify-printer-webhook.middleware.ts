import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../../../../app/config';
import { logger } from '../../../../shared/utils/logger';
import { WebhookLog } from '../../infrastructure/models/webhook-log.model';

export interface WebhookVerifiedRequest extends Request {
    webhookVerified?: boolean;
    webhookLogId?: string;
}

/**
 * Middleware xác thực chữ ký điện tử HMAC-SHA256 trong Header của webhook từ xưởng in
 */
export async function verifyPrinterWebhook(req: WebhookVerifiedRequest, res: Response, next: NextFunction) {
    const secret = config.printerWebhookSecret;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Trong môi trường development, nếu secret chưa được cấu hình, log cảnh báo nhưng cho phép qua
    if (!secret) {
        if (config.nodeEnv === 'production') {
            logger.error('[PRINTER WEBHOOK] PRINTER_WEBHOOK_SECRET chưa được cấu hình trong production. Từ chối.');
            return res.status(503).json({ error: 'Webhook secret is not configured' });
        }
        logger.warn('[PRINTER WEBHOOK] PRINTER_WEBHOOK_SECRET chưa được cấu hình. Bỏ qua xác thực ở môi trường dev.');
        req.webhookVerified = true;
        return next();
    }

    const signature = String(req.headers['x-webhook-signature'] || req.headers['x-signature'] || '');
    const timestamp = String(req.headers['x-webhook-timestamp'] || '');

    // Kiểm tra timestamp chống Replay Attack (nếu có truyền timestamp)
    if (timestamp) {
        const timeNum = Number(timestamp);
        const currentTime = Date.now();
        // Giới hạn trong khoảng 5 phút (+- 300,000ms)
        if (Math.abs(currentTime - timeNum) > 5 * 60 * 1000) {
            logger.warn(`[PRINTER WEBHOOK] Replay attack detected: Timestamp ${timestamp} lệch quá 5 phút so với hiện tại ${currentTime}`);
            await WebhookLog.create({
                provider: 'PRINTING_SHOP',
                event_type: req.body?.event || req.body?.status || 'UNKNOWN',
                order_code: req.body?.order_code,
                supplier_order_id: req.body?.supplier_order_id || req.body?._id,
                payload: req.body,
                headers: req.headers,
                signature_valid: false,
                status: 'INVALID_SIGNATURE',
                error_message: 'Webhook timestamp expired (Replay Attack prevention)',
                ip_address: String(clientIp),
                processed_at: new Date()
            }).catch(() => null);

            return res.status(401).json({ error: 'Unauthorized: Webhook timestamp expired' });
        }
    }

    if (!signature) {
        if (config.nodeEnv !== 'production') {
            logger.warn('[PRINTER WEBHOOK] Dev mode: Bỏ qua kiểm tra thiếu signature.');
            req.webhookVerified = true;
            return next();
        }
        logger.warn('[PRINTER WEBHOOK] Thiếu header x-webhook-signature.');
        await WebhookLog.create({
            provider: 'PRINTING_SHOP',
            event_type: req.body?.event || req.body?.status || 'UNKNOWN',
            order_code: req.body?.order_code,
            supplier_order_id: req.body?.supplier_order_id || req.body?._id,
            payload: req.body,
            headers: req.headers,
            signature_valid: false,
            status: 'INVALID_SIGNATURE',
            error_message: 'Missing x-webhook-signature header',
            ip_address: String(clientIp),
            processed_at: new Date()
        }).catch(() => null);

        return res.status(401).json({ error: 'Unauthorized: Missing webhook signature' });
    }

    try {
        // Hỗ trợ cả định dạng ký: timestamp.payload hoặc payload thuần
        const rawPayload = JSON.stringify(req.body);
        const dataWithTimestamp = timestamp ? `${timestamp}.${rawPayload}` : rawPayload;

        const expectedSig1 = crypto.createHmac('sha256', secret).update(dataWithTimestamp).digest('hex');
        const expectedSig2 = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');

        const sigBuf = Buffer.from(signature);
        const expBuf1 = Buffer.from(expectedSig1);
        const expBuf2 = Buffer.from(expectedSig2);

        const isValid = (sigBuf.length === expBuf1.length && crypto.timingSafeEqual(sigBuf, expBuf1)) ||
                        (sigBuf.length === expBuf2.length && crypto.timingSafeEqual(sigBuf, expBuf2));

        if (!isValid) {
            if (config.nodeEnv !== 'production') {
                logger.warn(`[PRINTER WEBHOOK] Dev mode: Chữ ký HMAC không khớp nhưng cho phép qua. Received: ${signature}`);
                req.webhookVerified = true;
                return next();
            }
            logger.error(`[PRINTER WEBHOOK] Sai chữ ký điện tử HMAC. Received: ${signature}`);
            await WebhookLog.create({
                provider: 'PRINTING_SHOP',
                event_type: req.body?.event || req.body?.status || 'UNKNOWN',
                order_code: req.body?.order_code,
                supplier_order_id: req.body?.supplier_order_id || req.body?._id,
                payload: req.body,
                headers: req.headers,
                signature_valid: false,
                status: 'INVALID_SIGNATURE',
                error_message: 'HMAC signature mismatch',
                ip_address: String(clientIp),
                processed_at: new Date()
            }).catch(() => null);

            return res.status(401).json({ error: 'Unauthorized: Invalid HMAC signature' });
        }

        req.webhookVerified = true;
        next();
    } catch (err: any) {
        if (config.nodeEnv !== 'production') {
            logger.warn(`[PRINTER WEBHOOK] Dev mode: Lỗi xác thực chữ ký: ${err.message}, vẫn cho phép qua.`);
            req.webhookVerified = true;
            return next();
        }
        logger.error(`[PRINTER WEBHOOK ERROR] Lỗi xác thực chữ ký: ${err.message}`);
        return res.status(500).json({ error: 'Internal error during signature validation' });
    }
}
