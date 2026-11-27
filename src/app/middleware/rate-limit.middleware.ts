import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from './auth.middleware';

const SWEEP_AT = 1000;

export function userRateLimit(max: number, windowMs: number, message: string) {
    const hits = new Map<string, { count: number; resetAt: number }>();

    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        const now = Date.now();
        if (hits.size > SWEEP_AT) {
            for (const [key, hit] of hits) if (hit.resetAt <= now) hits.delete(key);
        }

        const key = req.user?.id || req.ip || 'anonymous';
        let hit = hits.get(key);
        if (!hit || hit.resetAt <= now) {
            hit = { count: 0, resetAt: now + windowMs };
            hits.set(key, hit);
        }

        if (++hit.count > max) {
            res.setHeader('Retry-After', Math.ceil((hit.resetAt - now) / 1000));
            return res.status(429).json({ error: 'rate_limited', message });
        }
        next();
    };
}
