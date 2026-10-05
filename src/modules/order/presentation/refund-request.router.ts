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
import { ReturnRequestV3, ReturnEvidenceV3 } from '../infrastructure/models/return-request-v3.model';
import { createReturnRequestService } from '../application/return-request.runtime';
import { ReplacementOrderService } from '../application/replacement-order.service';
import { Order } from '../infrastructure/models/order.model';
import { User } from '../../user/infrastructure/models/user.model';

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
    const legacyDocs = await RefundRequestService.printerList();
    
    // Đồng bộ các yêu cầu V3 (Đổi hàng & Hoàn tiền theo món) của xưởng in
    const v3Docs = await ReturnRequestV3.find({
        status: { $in: ['PENDING_PRINTER', 'APPROVED', 'REJECTED', 'DISPUTED', 'AWAITING_ADMIN_REFUND'] }
    }).sort({ updated_at: -1, created_at: -1 }).limit(50).lean();
    const v3Mapped = await Promise.all(v3Docs.map(async (v3: any) => {
        const requestId = String(v3.id || v3._id);
        const evidences = await ReturnEvidenceV3.find({ request_id: requestId }).lean();
        let orderInfo: any = null;
        if (mongoose.Types.ObjectId.isValid(v3.order_id)) {
            orderInfo = await Order.findById(v3.order_id).select('order_code buyer_id items').lean();
        } else {
            orderInfo = await Order.findOne({ order_code: v3.order_id }).select('order_code buyer_id items').lean();
        }
        
        let buyerInfo: any = null;
        const buyerId = orderInfo?.buyer_id || v3.buyer_id;
        if (buyerId && mongoose.Types.ObjectId.isValid(buyerId)) {
            buyerInfo = await User.findById(buyerId).select('full_name email').lean();
        }

        const isExchange = v3.requested_resolution === 'EXCHANGE';
        const unitPrice = v3.item_snapshot?.unit_price || v3.item_snapshot?.price || 0;
        const totalAmount = unitPrice * (v3.quantity || 1);

        return {
            _id: requestId,
            id: requestId,
            is_v3: true,
            order_id: {
                _id: orderInfo?._id || v3.order_id,
                order_code: orderInfo?.order_code || v3.order_id,
            },
            buyer_id: {
                _id: v3.buyer_id,
                full_name: buyerInfo?.full_name || 'Khách hàng VietCraft',
                email: buyerInfo?.email || v3.buyer_id,
            },
            reason_category: `${v3.reason_code} - ${isExchange ? 'ĐỔI HÀNG (IN BÙ)' : 'HOÀN TIỀN'}`,
            reason_code: v3.reason_code,
            requested_resolution: v3.requested_resolution,
            description: v3.reason_description,
            evidence: evidences.map((e: any) => e.storage_ref),
            refund_type: isExchange ? 'EXCHANGE' : 'FULL',
            refund_amount: totalAmount,
            quantity: v3.quantity || 1,
            item_snapshot: v3.item_snapshot,
            status: v3.status,
            sla_deadlines: {
                printer_deadline: v3.deadline_at,
            },
            created_at: v3.created_at,
        };
    }));

    return res.json({ success: true, data: [...v3Mapped, ...legacyDocs] });
}));
router.post('/printer/refund-requests/:id/respond', verifyMockPrinter, asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const v3Doc: any = await ReturnRequestV3.findOne({ $or: [{ id }, { _id: id }] }).lean();
    if (v3Doc) {
        const requestId = String(v3Doc.id || v3Doc._id);
        const service = createReturnRequestService();
        const decision = String(req.body?.decision || '').toUpperCase();
        const printerAction = decision === 'APPROVE' ? 'APPROVE' : 'REJECT';
        const reason = String(req.body?.note || '').trim() || (printerAction === 'APPROVE' ? 'Xưởng in đã xác nhận và chấp thuận' : 'Xưởng in từ chối yêu cầu');
        const updated = await service.printerDecision({
            actorId: v3Doc.printer_id || 'PRINTING_SHOP_MOCK',
            devAdminActorId: v3Doc.printer_id || 'PRINTING_SHOP_MOCK',
            requestId,
            action: printerAction,
            reason,
        });

        if (printerAction === 'APPROVE' && (v3Doc.requested_resolution === 'EXCHANGE' || updated.final_resolution === 'EXCHANGE')) {
            try {
                await ReplacementOrderService.createAndDispatchReplacement(requestId);
                const freshDoc = await ReturnRequestV3.findOne({ $or: [{ id: requestId }, { _id: requestId }] }).lean();
                return res.json({ success: true, data: freshDoc || updated });
            } catch (err: any) {
                console.error('[REPLACEMENT CREATION ERROR]', err.message);
            }
        }

        return res.json({ success: true, data: updated });
    }

    if (!idOk(id)) throw new Error('ID không hợp lệ');
    const doc = await RefundRequestService.printerRespond(id, req.body?.decision, req.body?.note);
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
