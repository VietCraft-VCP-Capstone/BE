import { Request, Response, NextFunction } from 'express';
import { logger } from '../../shared/utils/logger';

// Unique request ID generator simulator
let requestCounter = 0;

export function requestIdAndLogger(req: Request, res: Response, next: NextFunction) {
    const requestId = `${Date.now()}-${++requestCounter}`;
    req.headers['x-request-id'] = requestId;
    res.setHeader('x-request-id', requestId);

    logger.info(`[ReqID: ${requestId}] ${req.method} ${req.originalUrl}`);
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info(`[ReqID: ${requestId}] ${req.method} ${req.originalUrl} - Status: ${res.statusCode} (${duration}ms)`);
    });
    next();
}

export const requestLogger = requestIdAndLogger;

