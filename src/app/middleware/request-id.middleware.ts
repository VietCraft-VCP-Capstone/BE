import { Request, Response, NextFunction } from 'express';
import { logger } from '../../shared/utils/logger';

// Unique request ID generator simulator
let requestCounter = 0;

/** Che token trong query: token xem ảnh CCCD mà lọt vào log thì ai đọc log cũng mở được ảnh. */
export const redactUrl = (url: string) => url.replace(/([?&]token=)[^&]*/gi, '$1***');

export function requestIdAndLogger(req: Request, res: Response, next: NextFunction) {
    const requestId = `${Date.now()}-${++requestCounter}`;
    req.headers['x-request-id'] = requestId;
    res.setHeader('x-request-id', requestId);

    const url = redactUrl(req.originalUrl);
    logger.info(`[ReqID: ${requestId}] ${req.method} ${url}`);
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info(`[ReqID: ${requestId}] ${req.method} ${url} - Status: ${res.statusCode} (${duration}ms)`);
    });
    next();
}

export const requestLogger = requestIdAndLogger;

