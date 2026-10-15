import crypto from 'crypto';
import type { Response, NextFunction } from 'express';
import { config } from '../../../../app/config';
import type { AuthenticatedRequest } from '../../../../app/middleware/auth.middleware';

export interface PrinterRefundRequest extends AuthenticatedRequest { printerActorId?: string }

function sameSecret(expected: string, supplied: string): boolean {
    const a = Buffer.from(expected), b = Buffer.from(supplied);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Partner credentials identify a workshop independently of marketplace user accounts. */
export function verifyPrinterRefundPartner(req: PrinterRefundRequest, res: Response, next: NextFunction) {
    const printerId = process.env.PRINTER_REFUND_PRINTER_ID?.trim();
    if (!config.printerRefundApiKey || !printerId) return res.status(503).json({ error: 'Printer Refund partner chưa được cấu hình' });
    if (!sameSecret(config.printerRefundApiKey, String(req.headers['x-vietcraft-refund-key'] || '')) || String(req.headers['x-printer-id'] || '') !== printerId) {
        return res.status(401).json({ error: 'Unauthorized Printer partner' });
    }
    req.printerActorId = printerId;
    next();
}

export function verifyMockPrinterRefund(req: PrinterRefundRequest, res: Response, next: NextFunction) {
    if (config.nodeEnv === 'production') return res.status(404).json({ error: 'Mock Printer disabled in production' });
    const secret = process.env.REFUND_PRINTER_MOCK_SECRET;
    if (!secret) return res.status(503).json({ error: 'Refund Printer mock chưa được cấu hình' });
    if (!sameSecret(secret, String(req.headers['x-refund-printer-secret'] || ''))) return res.status(401).json({ error: 'Unauthorized' });
    req.printerActorId = 'PRINTING_SHOP_MOCK';
    next();
}
