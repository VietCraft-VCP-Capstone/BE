import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { logger } from '../../shared/utils/logger';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
    logger.error(`Error processing path ${req.path}: ${err.message || err}`);
    const statusCode = err.status || 500;
    res.status(statusCode).json({
        error: err.message || 'Internal Server Error',
        stack: config.nodeEnv === 'development' ? err.stack : undefined
    });
}
