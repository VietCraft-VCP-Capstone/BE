import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { User } from '../../modules/user/infrastructure/models/user.model';
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

export type TokenCheck =
    | { ok: true; user: AuthUser }
    | { ok: false; status: number; code: string; error: string };

/**
 * Kiểm token đầy đủ: chữ ký, rồi tài khoản trong DB (bị khóa? đổi mật khẩu sau khi phát token?).
 * Vai trò lấy theo DB: vừa được duyệt người bán thì có quyền ngay, bị hạ quyền thì mất ngay.
 * Dùng chung cho REST, socket chat và route xem ảnh CCCD.
 */
export async function checkToken(token: string): Promise<TokenCheck> {
    let decoded: any;
    try {
        decoded = jwt.verify(token, config.jwtSecret);
    } catch {
        return { ok: false, status: 401, code: 'INVALID_TOKEN', error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.' };
    }
    let user: any;
    try {
        user = await User.findById(decoded.id).select('role is_locked token_version').lean();
    } catch {
        return { ok: false, status: 503, code: 'AUTH_UNAVAILABLE', error: 'Hệ thống đang bận, vui lòng thử lại sau.' };
    }
    if (!user || (user.token_version || 0) !== (decoded.tv || 0)) {
        return { ok: false, status: 401, code: 'TOKEN_REVOKED', error: 'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.' };
    }
    if (user.is_locked) {
        return { ok: false, status: 403, code: 'ACCOUNT_LOCKED', error: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.' };
    }
    return { ok: true, user: { id: decoded.id, email: decoded.email, role: normalizeRole(user.role) } as AuthUser };
}

export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Phiên làm việc đã hết hạn hoặc thiếu thông tin xác thực. Vui lòng đăng nhập lại.',
            code: 'UNAUTHORIZED'
        });
    }
    const result = await checkToken(authHeader.split(' ')[1]);
    if (!result.ok) return res.status(result.status).json({ error: result.error, code: result.code });
    req.user = result.user;
    next();
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
