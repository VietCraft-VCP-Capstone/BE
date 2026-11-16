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
import { ReturnRequest, ReturnEvidence } from '../infrastructure/models/return-request.model';
import { createReturnRequestService } from '../application/return-request.runtime';
import { ReplacementOrderService } from '../application/replacement-order.service';
import { Order } from '../infrastructure/models/order.model';
import { User } from '../../user/infrastructure/models/user.model';
import { RefundRequest } from '../infrastructure/models/refund-request.model';
import { ReturnRequestLog } from '../infrastructure/models/return-request.model';
import { verifyPrinterRefundPartner, verifyMockPrinterRefund, type PrinterRefundRequest } from './middlewares/verify-printer-refund.middleware';

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
router.post('/seller/refund-requests/:id/retry-execution', authenticate, requireRole(['seller', 'admin']), asyncHandler(async (req, res) => {
    const role = String(req.user!.role).toLowerCase() === 'admin' ? 'ADMIN' : 'SELLER';
    const doc = await RefundRequestService.retryExecution(req.params.id, req.user!.id, role);
    return res.json({ success: true, data: doc });
}));
router.get('/seller/refund-requests/:id/manual-info', authenticate, requireRole(['seller', 'admin']), asyncHandler(async (req, res) => {
    const role = String(req.user!.role).toLowerCase() === 'admin' ? 'ADMIN' : 'SELLER';
    return res.json({ success: true, data: await RefundRequestService.manualRefundInfo(req.params.id, req.user!.id, role) });
}));
router.post('/seller/refund-requests/:id/manual-settle', authenticate, requireRole(['seller', 'admin']), asyncHandler(async (req, res) => {
    const role = String(req.user!.role).toLowerCase() === 'admin' ? 'ADMIN' : 'SELLER';
    const doc = await RefundRequestService.settleManually(req.params.id, req.user!.id, role, req.body?.reference, req.body?.note);
    return res.json({ success: true, data: doc });
}));
router.post('/seller/refund-requests/:id/dispute', authenticate, requireRole(['seller', 'admin']), asyncHandler(async (req, res) => {
    const doc = await RefundRequestService.sellerDispute(req.params.id, req.user!.id, req.body?.reason);
    return res.json({ success: true, data: doc });
}));

const listPrinterRefunds = asyncHandler(async (req: PrinterRefundRequest, res) => {
    const printerId = req.printerActorId!;
    const printerQuery = ['PRINTER_SHOP', 'PRINTING_SHOP_MOCK'].includes(printerId)
        ? { $in: ['PRINTER_SHOP', 'PRINTING_SHOP_MOCK', printerId] }
        : printerId;
    const legacyDocs = await RefundRequest.find({ printer_id: printerQuery, status: 'PENDING_PRINTER' })
        .populate('order_id').populate('buyer_id', 'full_name email').sort({ created_at: 1 }).lean();
    
    // Đồng bộ các yêu cầu đổi trả (Đổi hàng & Hoàn tiền theo món) của xưởng in
    const returnDocs = await ReturnRequest.find({
        printer_id: printerQuery,
        status: { $in: ['PENDING_PRINTER', 'APPROVED', 'REJECTED', 'DISPUTED', 'AWAITING_ADMIN_REFUND'] }
    }).sort({ updated_at: -1, created_at: -1 }).limit(50).lean();
    const returnMapped = await Promise.all(returnDocs.map(async (returnReq: any) => {
        const requestId = String(returnReq.id || returnReq._id);
        const evidences = await ReturnEvidence.find({ request_id: requestId }).lean();
        let orderInfo: any = null;
        if (mongoose.Types.ObjectId.isValid(returnReq.order_id)) {
            orderInfo = await Order.findById(returnReq.order_id).select('order_code buyer_id items').lean();
        } else {
            orderInfo = await Order.findOne({ order_code: returnReq.order_id }).select('order_code buyer_id items').lean();
        }
        
        let buyerInfo: any = null;
        const buyerId = orderInfo?.buyer_id || returnReq.buyer_id;
        if (buyerId && mongoose.Types.ObjectId.isValid(buyerId)) {
            buyerInfo = await User.findById(buyerId).select('full_name email').lean();
        }

        const isExchange = returnReq.requested_resolution === 'EXCHANGE';
        const unitPrice = returnReq.item_snapshot?.unit_price || returnReq.item_snapshot?.price || 0;
        const totalAmount = unitPrice * (returnReq.quantity || 1);
        const orderCode = orderInfo?.order_code || returnReq.order_id;

        return {
            _id: requestId,
            id: requestId,
            is_return_request: true,
            printer_id: returnReq.printer_id || printerId,
            order_id: {
                _id: orderInfo?._id || returnReq.order_id,
                order_code: orderCode,
            },
            order_code: orderCode,
            buyer_id: {
                _id: returnReq.buyer_id,
                full_name: buyerInfo?.full_name || 'Khách hàng VietCraft',
                email: buyerInfo?.email || returnReq.buyer_id,
            },
            reason_category: `${returnReq.reason_code} - ${isExchange ? 'ĐỔI HÀNG (IN BÙ)' : 'HOÀN TIỀN'}`,
            reason_code: returnReq.reason_code,
            requested_resolution: returnReq.requested_resolution,
            description: returnReq.reason_description,
            evidence: evidences.map((e: any) => e.storage_ref),
            refund_type: isExchange ? 'EXCHANGE' : 'FULL',
            refund_amount: totalAmount,
            quantity: returnReq.quantity || 1,
            item_snapshot: returnReq.item_snapshot,
            status: returnReq.status,
            sla_deadlines: {
                printer_deadline: returnReq.deadline_at,
            },
            created_at: returnReq.created_at,
        };
    }));

    return res.json({ success: true, data: [...returnMapped, ...legacyDocs] });
});
const respondToPrinterRefund = asyncHandler(async (req: PrinterRefundRequest, res) => {
    const id = String(req.params.id);
    const printerId = req.printerActorId!;
    const isMatchedPrinter = (targetId: string | undefined | null) => {
        if (!targetId || targetId === printerId) return true;
        if (['PRINTER_SHOP', 'PRINTING_SHOP_MOCK'].includes(printerId) && ['PRINTER_SHOP', 'PRINTING_SHOP_MOCK'].includes(targetId)) return true;
        return false;
    };
    const decision = String(req.body?.decision || '').toUpperCase();
    const note = String(req.body?.note || '').trim();
    if (!['APPROVE', 'REJECT'].includes(decision)) throw new Error('decision không hợp lệ');
    if (decision === 'REJECT' && note.length < 3) throw new Error('Khi từ chối, cần ghi rõ lý do (ít nhất 3 ký tự)');
    const returnDoc: any = await ReturnRequest.findOne({ $or: [{ id }, { _id: id }] }).lean();
    if (returnDoc) {
        if (!isMatchedPrinter(returnDoc.printer_id)) return res.status(403).json({ error: 'Assigned Printer required' });
        const requestId = String(returnDoc.id || returnDoc._id);
        // Retry after a lost callback response must acknowledge the original decision.
        const previous = await ReturnRequestLog.findOne({ request_id: requestId, actor_id: printerId, actor_role: 'PRINTER',
            to_status: { $in: decision === 'APPROVE' ? ['APPROVED', 'AWAITING_ADMIN_REFUND'] : ['REJECTED'] } }).lean();
        if (previous) return res.json({ success: true, data: returnDoc });
        const service = createReturnRequestService();
        const printerAction = decision as 'APPROVE' | 'REJECT';
        const reason = note || 'Xưởng in đã xác nhận và chấp thuận';
        const rawEvidence: any[] = Array.isArray(req.body?.evidence) ? req.body.evidence : (Array.isArray(req.body?.evidence_urls) ? req.body.evidence_urls.map((u: string) => ({ id: crypto.randomUUID(), kind: 'IMAGE' as const, uri: u })) : []);
        const printerEvidence = rawEvidence.map((e: any) => ({
            id: e.id || crypto.randomUUID(),
            kind: e.kind === 'VIDEO' ? 'VIDEO' as const : 'IMAGE' as const,
            uri: e.uri || e.url || e.storage_ref || String(e),
        })).filter(e => typeof e.uri === 'string' && e.uri.trim());
        const updated = await service.printerDecision({
            actorId: printerId,
            requestId,
            action: printerAction,
            reason,
            evidence: printerEvidence,
        });

        if (printerAction === 'APPROVE' && (returnDoc.requested_resolution === 'EXCHANGE' || updated.final_resolution === 'EXCHANGE')) {
            try {
                await ReplacementOrderService.createAndDispatchReplacement(requestId);
                const freshDoc = await ReturnRequest.findOne({ $or: [{ id: requestId }, { _id: requestId }] }).lean();
                return res.json({ success: true, data: freshDoc || updated });
            } catch (err: any) {
                console.error('[REPLACEMENT CREATION ERROR]', err.message);
            }
        }

        return res.json({ success: true, data: updated });
    }

    if (!idOk(id)) throw new Error('ID không hợp lệ');
    const assigned = await RefundRequest.findById(id).lean();
    if (!assigned) return res.status(404).json({ error: 'Không tìm thấy yêu cầu hoàn tiền' });
    if (!isMatchedPrinter(assigned.printer_id)) return res.status(403).json({ error: 'Assigned Printer required' });
    if (assigned.printer_response?.decision === decision) return res.json({ success: true, data: assigned });
    const doc = await RefundRequestService.printerRespond(id, decision as 'APPROVE' | 'REJECT', note);
    return res.json({ success: true, data: doc });
});
router.get('/printer/refund-requests', verifyPrinterRefundPartner, listPrinterRefunds);
router.post('/printer/refund-requests/:id/respond', verifyPrinterRefundPartner, respondToPrinterRefund);
router.get('/printer/mock/refund-requests', verifyMockPrinterRefund, listPrinterRefunds);
router.post('/printer/mock/refund-requests/:id/respond', verifyMockPrinterRefund, respondToPrinterRefund);
router.get('/admin/refund-requests', authenticate, requireRole(['admin']), asyncHandler(async (req, res) => {
    const docs = await RefundRequestService.adminList(typeof req.query.status === 'string' ? req.query.status : 'DISPUTED');
    return res.json({ success: true, data: docs });
}));
router.post('/admin/refund-requests/:id/resolve', authenticate, requireRole(['admin']), asyncHandler(async (req, res) => {
    const doc = await RefundRequestService.adminResolve(req.params.id, req.user!.id, req.body?.decision, req.body?.cost_bearer, req.body?.refund_amount, req.body?.note || '');
    return res.json({ success: true, data: doc });
}));

export const refundRequestRouter = router;
