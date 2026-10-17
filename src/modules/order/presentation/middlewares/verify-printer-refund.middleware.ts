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
    const defaultPrinterId = process.env.PRINTER_REFUND_PRINTER_ID?.trim() || 'PRINTER_SHOP';
    const apiKey = config.printerRefundApiKey || process.env.PRINTER_REFUND_API_KEY || '';
    const mockSecret = process.env.REFUND_PRINTER_MOCK_SECRET || apiKey;
    
    if (!apiKey && !mockSecret) return res.status(503).json({ error: 'Printer Refund partner chưa được cấu hình' });

    const suppliedKey = String(req.headers['x-vietcraft-refund-key'] || '');
    const suppliedSecret = String(req.headers['x-refund-printer-secret'] || '');
    const suppliedPrinterId = String(req.headers['x-printer-id'] || '').trim();

    // Check partner key or secret
    const keyValid = apiKey && suppliedKey && sameSecret(apiKey, suppliedKey);
    const secretValid = (mockSecret && suppliedSecret && sameSecret(mockSecret, suppliedSecret)) ||
                        (apiKey && suppliedSecret && sameSecret(apiKey, suppliedSecret));

    if (!keyValid && !secretValid) {
        return res.status(401).json({ error: 'Unauthorized Printer partner' });
    }

    req.printerActorId = suppliedPrinterId || defaultPrinterId;
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
