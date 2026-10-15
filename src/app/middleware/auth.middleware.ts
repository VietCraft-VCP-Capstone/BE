import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthUser, Role, AuthenticatedRequest } from '../types/auth';

// Type gốc nằm ở ../types/auth. Re-export tại đây để các router vẫn import được
// middleware và type từ cùng một chỗ, khỏi phải sửa 10 file consumer.
export type { AuthUser, Role, AuthenticatedRequest };

export function normalizeRole(role?: string): string {
    return String(role || '').toLowerCase();
}

export function hasRole(user: AuthUser | undefined, roles: Role[]): boolean {
    if (!user) return false;
    return roles.includes(normalizeRole(user.role) as Role);
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Phiên làm việc đã hết hạn hoặc thiếu thông tin xác thực. Vui lòng đăng nhập lại.',
            code: 'UNAUTHORIZED'
        });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, config.jwtSecret) as any;
        req.user = { id: decoded.id, email: decoded.email, role: decoded.role };
        next();
    } catch (error) {
        return res.status(401).json({
            error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.',
            code: 'INVALID_TOKEN'
        });
    }
}

export function requireRole(roles: Role[]) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Vui lòng đăng nhập để thực hiện thao tác này.',
                code: 'UNAUTHORIZED'
            });
        }
        if (!hasRole(req.user, roles)) {
            return res.status(403).json({
                error: `Bạn không có quyền truy cập chức năng này (yêu cầu quyền: ${roles.join(', ')}).`,
                code: 'FORBIDDEN'
            });
        }
        next();
    };
}

export function optionalAuthenticate(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, config.jwtSecret) as any;
            req.user = { id: decoded.id, email: decoded.email, role: decoded.role };
        } catch {
            // Không ngắt luồng nếu token không hợp lệ hoặc hết hạn ở route public
        }
    }
    next();
}
