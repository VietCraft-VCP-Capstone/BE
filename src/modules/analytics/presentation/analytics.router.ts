import { Router } from 'express';
import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';
import { authenticate } from '../../../app/middleware/auth.middleware';

const router = Router();

router.post('/forecasting', authenticate, async (req, res) => {
    try {
        const pythonUrl = `${config.aiAnalyticsUrl}/api/v1/forecasting`;
        logger.info(`Proxying forecasting request to Python AI: ${pythonUrl}`);

        const response = await fetch(pythonUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
        });

        if (!response.ok) {
            const errText = await response.text();
            return res.status(response.status).json({ error: `FastAPI error: ${errText}` });
        }

        const data = await response.json();
        res.json(data);
    } catch (error: any) {
        logger.error(`Forecasting proxy failed: ${error.message}`);
        res.status(502).json({ error: 'FastAPI service unavailable' });
    }
});

router.post('/health-score', authenticate, async (req, res) => {
    try {
        const pythonUrl = `${config.aiAnalyticsUrl}/api/v1/health_score`;
        logger.info(`Proxying health-score request to Python AI: ${pythonUrl}`);

        const response = await fetch(pythonUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
        });

        if (!response.ok) {
            const errText = await response.text();
            return res.status(response.status).json({ error: `FastAPI error: ${errText}` });
        }

        const data = await response.json();
        res.json(data);
    } catch (error: any) {
        logger.error(`Health-score proxy failed: ${error.message}`);
        res.status(502).json({ error: 'FastAPI service unavailable' });
    }
});

router.post('/anomaly', authenticate, async (req, res) => {
    try {
        const pythonUrl = `${config.aiAnalyticsUrl}/api/v1/anomaly`;
        logger.info(`Proxying anomaly request to Python AI: ${pythonUrl}`);

        const response = await fetch(pythonUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
        });

        if (!response.ok) {
            const errText = await response.text();
            return res.status(response.status).json({ error: `FastAPI error: ${errText}` });
        }

        const data = await response.json();
        res.json(data);
    } catch (error: any) {
        logger.error(`Anomaly proxy failed: ${error.message}`);
        res.status(502).json({ error: 'FastAPI service unavailable' });
    }
});

export const analyticsRouter = router;
export default analyticsRouter;
