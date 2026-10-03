import { Router, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import mongoose from 'mongoose';
import { AuthenticatedRequest, authenticate, requireRole } from '../../../app/middleware/auth.middleware';
import { config } from '../../../app/config';
import { UploadService } from '../../upload/application/upload.service';
import { UPLOAD_ROOT, publicUrl } from '../../../shared/upload/upload.middleware';
import { RefundRequestService } from '../application/refund-request.service';
import { isValidRefundImageBuffer, isValidRefundVideoBuffer } from '../application/refund-evidence-policy';

const router = Router();
const asyncHandler = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) => (req: AuthenticatedRequest, res: Response) => {
    void fn(req, res).catch((error: Error & { statusCode?: number }) => res.status(error.statusCode || (/không tìm thấy/i.test(error.message) ? 404 : 400)).json({ error: error.message }));
};
const idOk = (id: string) => mongoose.Types.ObjectId.isValid(id);

const REFUND_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const REFUND_VIDEO_TYPES = new Map([['video/mp4', '.mp4'], ['video/webm', '.webm'], ['video/quicktime', '.mov']]);
const refundEvidenceUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
        if (REFUND_IMAGE_TYPES.has(file.mimetype) || REFUND_VIDEO_TYPES.has(file.mimetype)) cb(null, true);
        else cb(new Error('Chỉ chấp nhận ảnh JPG, PNG, WebP hoặc video MP4, WebM, MOV.'));
    },
});

router.post('/refund-evidence/upload', authenticate, requireRole(['buyer']), (req, res) => {
    refundEvidenceUpload.single('file')(req, res, async error => {
        if (error) {
            const message = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
                ? 'Tệp quá lớn. Ảnh tối đa 10MB, video tối đa 50MB.' : error.message;
            res.status(400).json({ error: message });
            return;
        }
        try {
            const file = req.file;
            if (!file) { res.status(400).json({ error: 'Hãy chọn một ảnh hoặc video minh chứng.' }); return; }
            const isImage = REFUND_IMAGE_TYPES.has(file.mimetype);
            if (isImage && file.size > 10 * 1024 * 1024) { res.status(400).json({ error: 'Ảnh tối đa 10MB.' }); return; }
            if (!isImage && !isValidRefundVideoBuffer(file.buffer)) { res.status(400).json({ error: 'Tệp video không hợp lệ hoặc không đúng định dạng.' }); return; }
            if (isImage && !isValidRefundImageBuffer(file.buffer)) { res.status(400).json({ error: 'Tệp ảnh không hợp lệ hoặc không đúng định dạng.' }); return; }
            if (isImage) {
                const result = await UploadService.uploadSingle(file, { folder: 'refunds' });
                res.status(201).json({ url: result.url, kind: 'image' });
                return;
            }
            const extension = REFUND_VIDEO_TYPES.get(file.mimetype)!;
            const directory = path.join(UPLOAD_ROOT, 'refunds');
            await fs.promises.mkdir(directory, { recursive: true });
            const filename = `${crypto.randomUUID()}${extension}`;
            await fs.promises.writeFile(path.join(directory, filename), file.buffer, { flag: 'wx' });
            res.status(201).json({ url: publicUrl(path.join(directory, filename)), kind: 'video' });
        } catch (uploadError: any) {
            res.status(400).json({ error: uploadError.message || 'Không thể tải minh chứng lên.' });
        }
    });
});

router.post('/orders/:orderId/refund-test-flow', authenticate, requireRole(['buyer']), asyncHandler(async (req, res) => {
    const result = await RefundRequestService.createTestFlow(req.params.orderId, req.user!.id);
    return res.status(201).json({ success: true, data: result });
}));

router.get('/orders/:orderId/refund-requests', authenticate, requireRole(['buyer']), asyncHandler(async (req, res) => {
    const doc = await RefundRequestService.getForOrder(req.params.orderId, req.user!.id);
    return res.json({ success: true, data: doc });
}));
router.post('/orders/:orderId/refund-requests', authenticate, requireRole(['buyer']), asyncHandler(async (req, res) => {
    const doc = await RefundRequestService.create(req.params.orderId, req.user!.id, req.body || {});
    return res.status(201).json({ success: true, data: doc });
}));
router.get('/refund-requests/:id', authenticate, asyncHandler(async (req, res) => {
    const doc = await RefundRequestService.getForBuyer(req.params.id, req.user!.id);
    return res.json({ success: true, data: doc });
}));
router.post('/refund-requests/:id/dispute', authenticate, requireRole(['buyer']), asyncHandler(async (req, res) => {
    if (!req.body?.reason?.trim()) throw new Error('Cần cung cấp lý do dispute');
    const doc = await RefundRequestService.dispute(req.params.id, req.user!.id, req.body.reason);
    return res.status(201).json({ success: true, data: doc });
}));
router.get('/seller/refund-requests', authenticate, requireRole(['seller', 'admin']), asyncHandler(async (req, res) => {
    const docs = await RefundRequestService.sellerList(req.user!.id, typeof req.query.status === 'string' ? req.query.status : undefined);
    return res.json({ success: true, data: docs });
}));
router.post('/seller/refund-requests/:id/triage', authenticate, requireRole(['seller', 'admin']), asyncHandler(async (req, res) => {
    const doc = await RefundRequestService.triage(req.params.id, req.user!.id, req.body?.triage_result, req.body?.checklist);
    return res.json({ success: true, data: doc });
}));
router.post('/seller/refund-requests/:id/decision', authenticate, requireRole(['seller', 'admin']), asyncHandler(async (req, res) => {
    const doc = await RefundRequestService.sellerDecision(req.params.id, req.user!.id, req.body?.decision, req.body?.note);
    return res.json({ success: true, data: doc });
}));
router.post('/seller/refund-requests/:id/dispute', authenticate, requireRole(['seller', 'admin']), asyncHandler(async (req, res) => {
    const doc = await RefundRequestService.sellerDispute(req.params.id, req.user!.id, req.body?.reason);
    return res.json({ success: true, data: doc });
}));

function verifyMockPrinter(req: AuthenticatedRequest, res: Response, next: (error?: unknown) => void) {
    if (config.nodeEnv === 'production') return res.status(404).json({ error: 'Mock Printer disabled in production' });
    const expected = process.env.REFUND_PRINTER_MOCK_SECRET;
    if (!expected) return res.status(503).json({ error: 'Refund Printer mock chưa được cấu hình' });
    const supplied = String(req.headers['x-refund-printer-secret'] || '');
    const a = Buffer.from(expected); const b = Buffer.from(supplied);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Unauthorized' });
    next();
}
router.get('/printer/refund-requests', verifyMockPrinter, asyncHandler(async (_req, res) => {
    const docs = await RefundRequestService.printerList();
    return res.json({ success: true, data: docs });
}));
router.post('/printer/refund-requests/:id/respond', verifyMockPrinter, asyncHandler(async (req, res) => {
    if (!idOk(req.params.id)) throw new Error('ID không hợp lệ');
    const doc = await RefundRequestService.printerRespond(req.params.id, req.body?.decision, req.body?.note);
    return res.json({ success: true, data: doc });
}));
router.get('/admin/refund-requests', authenticate, requireRole(['admin']), asyncHandler(async (req, res) => {
    const docs = await RefundRequestService.adminList(typeof req.query.status === 'string' ? req.query.status : 'DISPUTED');
    return res.json({ success: true, data: docs });
}));
router.post('/admin/refund-requests/:id/resolve', authenticate, requireRole(['admin']), asyncHandler(async (req, res) => {
    const doc = await RefundRequestService.adminResolve(req.params.id, req.user!.id, req.body?.decision, req.body?.cost_bearer, req.body?.refund_amount, req.body?.note || '');
    return res.json({ success: true, data: doc });
}));

export const refundRequestRouter = router;
