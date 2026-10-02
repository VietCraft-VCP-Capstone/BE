import crypto from 'crypto';
import { NextFunction, Response, Router } from 'express';
import { authenticate, AuthenticatedRequest, requireRole } from '../../../app/middleware/auth.middleware';
import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';
import { RefundError } from '../application/refund.error';
import { RefundService } from '../application/refund.service';
import { payosPayoutService } from '../application/payos-payout.service';

const router = Router();

// Payout webhook không được tin trực tiếp: payload chỉ dùng để tìm refund, sau đó BE
// poll lại API payOS đã ký. Secret dưới đây là lớp giảm request rác, không phải nguồn
// xác thực trạng thái tiền.
router.post('/webhooks/payos-payout', async (req, res) => {
    const expected = config.payos.payoutWebhookSecret;
    if (expected) {
        const supplied = String(req.headers['x-payos-webhook-secret'] || req.query.secret || '');
        const a = Buffer.from(supplied);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            return res.status(401).json({ error: 'invalid_webhook_secret' });
        }
    }
    try {
        await RefundService.handlePayOSWebhook(req.body);
    } catch (error: any) {
        // Reconcile worker là safety net; trả 200 để provider không tạo bão retry.
        logger.warn(`[PAYOS PAYOUT] Webhook chưa apply được: ${error.message}`);
    }
    return res.json({ success: true });
});

router.use(authenticate);

router.get('/meta', (_req, res) => {
    res.json({
        ...payosPayoutService.status(),
        refundWindowSeconds: config.refund.windowSeconds,
        maxAttempts: config.refund.maxAttempts,
    });
});

function replyError(error: any, res: Response, next: NextFunction) {
    if (error instanceof RefundError) {
        return res.status(error.statusCode).json({ error: error.reason, message: error.message });
    }
    logger.error(`[REFUND] ${error?.stack || error?.message || error}`);
    return next(error);
}

/** Buyer tạo yêu cầu hoàn toàn bộ đơn. Idempotency-Key là bắt buộc. */
router.post('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const result = await RefundService.create(
            req.user!.id,
            req.body || {},
            String(req.headers['idempotency-key'] || ''),
        );
        return res.status(result.replayed ? 200 : 201).json({
            data: result.refund,
            replayed: result.replayed,
        });
    } catch (error) {
        return replyError(error, res, next);
    }
});

router.get('/mine', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const data = await RefundService.listMine(req.user!.id, {
            status: req.query.status as string,
            page: Number(req.query.page),
            limit: Number(req.query.limit),
        });
        return res.json(data);
    } catch (error) {
        return replyError(error, res, next);
    }
});

/** Buyer: đơn này còn hoàn được không, còn bao lâu, và refund hiện có (nếu có). */
router.get('/orders/:orderId/eligibility', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        return res.json({ data: await RefundService.eligibility(req.user!.id, req.params.orderId) });
    } catch (error) {
        return replyError(error, res, next);
    }
});

router.get(
    '/manage',
    requireRole(['seller', 'admin']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            const data = await RefundService.listManaged(req.user!, {
                status: req.query.status as string,
                page: Number(req.query.page),
                limit: Number(req.query.limit),
            });
            return res.json(data);
        } catch (error) {
            return replyError(error, res, next);
        }
    },
);

router.get(
    '/:id/instruction',
    requireRole(['seller', 'admin']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            return res.json({ data: await RefundService.instruction(req.params.id, req.user!) });
        } catch (error) {
            return replyError(error, res, next);
        }
    },
);

router.post(
    '/:id/approve',
    requireRole(['seller', 'admin']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            return res.json({ data: await RefundService.approve(req.params.id, req.user!) });
        } catch (error) {
            return replyError(error, res, next);
        }
    },
);

router.post(
    '/:id/reject',
    requireRole(['seller', 'admin']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            return res.json({ data: await RefundService.reject(req.params.id, req.user!, req.body?.note) });
        } catch (error) {
            return replyError(error, res, next);
        }
    },
);

router.post(
    '/:id/settle',
    requireRole(['seller', 'admin']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            return res.json({ data: await RefundService.settle(req.params.id, req.user!, req.body?.evidenceRef) });
        } catch (error) {
            return replyError(error, res, next);
        }
    },
);

router.post(
    '/:id/retry',
    requireRole(['seller', 'admin']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            return res.json({ data: await RefundService.retry(req.params.id, req.user!) });
        } catch (error) {
            return replyError(error, res, next);
        }
    },
);

router.post(
    '/:id/reconcile',
    requireRole(['seller', 'admin']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            return res.json({ data: await RefundService.reconcile(req.params.id, req.user!) });
        } catch (error) {
            return replyError(error, res, next);
        }
    },
);

router.post(
    '/:id/cancel',
    requireRole(['seller', 'admin']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            return res.json({ data: await RefundService.cancel(req.params.id, req.user!) });
        } catch (error) {
            return replyError(error, res, next);
        }
    },
);

router.get('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        return res.json({ data: await RefundService.get(req.params.id, req.user!) });
    } catch (error) {
        return replyError(error, res, next);
    }
});

export const refundRouter = router;
export default router;
