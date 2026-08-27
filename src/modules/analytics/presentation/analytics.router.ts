import { Router, Response } from 'express';
import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';
import { authenticate } from '../../../app/middleware/auth.middleware';

const router = Router();

// Service AI (FastAPI) là hệ thống ngoài: luôn phải có timeout, nếu không request sẽ treo vô hạn
// và giữ connection của Node cho tới khi client bỏ cuộc.
const AI_TIMEOUT_MS = 15000;

/** Proxy 1 request sang service AI. Lỗi ngoài -> 502 theo chuẩn lỗi chung. */
async function proxyToAi(label: string, endpoint: string, body: unknown, res: Response) {
    const pythonUrl = `${config.aiAnalyticsUrl}${endpoint}`;
    logger.info(`Proxying ${label} request to Python AI: ${pythonUrl}`);

    try {
        const response = await fetch(pythonUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        });

        if (!response.ok) {
            const errText = await response.text();
            return res.status(response.status).json({ error: `FastAPI error: ${errText}` });
        }

        const data = await response.json();
        return res.json(data);
    } catch (error: any) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        logger.error(`${label} proxy failed: ${timedOut ? `timeout sau ${AI_TIMEOUT_MS}ms` : error.message}`);
        return res.status(502).json({
            error: timedOut ? 'FastAPI service timeout' : 'FastAPI service unavailable',
        });
    }
}

router.post('/forecasting', authenticate, (req, res) =>
    proxyToAi('forecasting', '/api/v1/forecasting', req.body, res));

router.post('/health-score', authenticate, (req, res) =>
    proxyToAi('health-score', '/api/v1/health_score', req.body, res));

router.post('/anomaly', authenticate, (req, res) =>
    proxyToAi('anomaly', '/api/v1/anomaly', req.body, res));

export const analyticsRouter = router;
export default analyticsRouter;
