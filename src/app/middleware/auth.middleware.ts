import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        email: string;
        role: 'buyer' | 'seller' | 'admin';
    };
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or malformed token' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, config.jwtSecret) as any;
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
}

export function requireRole(roles: Array<'buyer' | 'seller' | 'admin'>) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized: Not authenticated' });
        }
        const userRoleLower = req.user.role.toLowerCase() as any;
        if (!roles.includes(userRoleLower)) {
            return res.status(403).json({ error: `Forbidden: Requires one of [${roles.join(', ')}] roles` });
        }
        next();
    };
}
