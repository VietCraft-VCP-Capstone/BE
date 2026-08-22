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

// Fallback demo user for local development testing when token is missing
const DEV_MOCK_USER = {
    id: '650000000000000000000001',
    email: 'buyer@vietcraft.com',
    role: 'buyer' as const
};

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, config.jwtSecret) as any;
            req.user = decoded;
            return next();
        } catch (error) {
            if (config.nodeEnv === 'development') {
                req.user = DEV_MOCK_USER;
                return next();
            }
            return res.status(401).json({ error: 'Unauthorized: Invalid token' });
        }
    }

    // In development environment, fallback to DEV_MOCK_USER for easy local testing
    if (config.nodeEnv === 'development') {
        req.user = DEV_MOCK_USER;
        return next();
    }

    return res.status(401).json({ error: 'Unauthorized: Missing or malformed token' });
}

export function requireRole(roles: Array<'buyer' | 'seller' | 'admin'>) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized: Not authenticated' });
        }
        const userRole = req.user.role?.toLowerCase() as 'buyer' | 'seller' | 'admin';
        if (!roles.includes(userRole)) {
            return res.status(403).json({ error: `Forbidden: Requires one of [${roles.join(', ')}] roles` });
        }
        next();
    };
}
