import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { logger } from '../../shared/utils/logger';

// Chuẩn lỗi HTTP dùng chung (contract mục 5):
// 400 validation | 401 chưa đăng nhập | 403 sai quyền | 404 không thấy | 502 lỗi service ngoài.
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
    logger.error(`Error processing path ${req.path}: ${err.message || err}`);

    // ValidationError: bản của service (errors là string[]) lẫn của Mongoose (errors là object).
    if (err.name === 'ValidationError') {
        const errors = Array.isArray(err.errors)
            ? err.errors
            : Object.values(err.errors || {}).map((e: any) => e?.message).filter(Boolean);
        return res.status(400).json({ error: err.message || 'Validation failed', errors });
    }
    if (err.name === 'ForbiddenError') {
        return res.status(403).json({ error: err.message });
    }
    // Id sai định dạng ObjectId -> lỗi client, không phải 500.
    if (err.name === 'CastError') {
        return res.status(400).json({ error: 'Tham số không hợp lệ' });
    }
    // Trùng unique index.
    if (err.code === 11000) {
        return res.status(400).json({ error: 'Dữ liệu đã tồn tại (trùng khoá duy nhất)' });
    }

    const statusCode = err.status || err.statusCode || 500;
    // Lỗi 5xx ở production không lộ chi tiết nội bộ ra ngoài.
    const message = statusCode >= 500 && config.nodeEnv === 'production'
        ? 'Internal Server Error'
        : (err.message || 'Internal Server Error');

    res.status(statusCode).json({
        error: message,
        stack: config.nodeEnv === 'development' ? err.stack : undefined
    });
}
