import { Router } from 'express';
import { optionalAuthenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { userRateLimit } from '../../../app/middleware/rate-limit.middleware';
import { NewsletterService, NewsletterValidationError } from '../application/newsletter.service';

export const newsletterRouter = Router();

newsletterRouter.post(
    '/subscribe',
    optionalAuthenticate,
    userRateLimit(5, 10 * 60_000, 'Bạn gửi đăng ký quá nhiều lần, vui lòng thử lại sau ít phút.'),
    async (req: AuthenticatedRequest, res) => {
        try {
            const result = await NewsletterService.subscribe({
                email: req.body?.email,
                source: req.body?.source,
                userId: req.user?.id,
                ip: req.ip,
                userAgent: req.get('user-agent'),
            });
            res.status(result.alreadySubscribed ? 200 : 201).json({ subscribed: true, alreadySubscribed: result.alreadySubscribed });
        } catch (error: any) {
            if (error instanceof NewsletterValidationError) return res.status(400).json({ error: error.message });
            res.status(500).json({ error: 'Không thể đăng ký nhận tin lúc này, vui lòng thử lại sau.' });
        }
    },
);
