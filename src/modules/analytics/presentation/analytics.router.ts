import { Router, Response } from 'express';
import { EventService } from '../application/event.service';
import { optionalAuthenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

/**
 * POST /api/events/view
 * Record a product view event
 * Body: { product_id: string, session_id: string }
 */
router.post('/events/view', optionalAuthenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { product_id, session_id } = req.body;
        const userAgent = req.get('user-agent') || '';
        const ipAddress = req.ip || req.socket.remoteAddress || '';
        const userId = req.user?.id;

        if (!product_id || !session_id) {
            return res.status(400).json({ error: 'Missing product_id or session_id' });
        }

        const recorded = await EventService.recordEvent(
            product_id,
            session_id,
            'view',
            userAgent,
            ipAddress,
            userId
        );

        res.json({ success: recorded });
    } catch (error) {
        console.error('Error recording view event:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/events/add-to-cart
 * Record a product add-to-cart event (optional client-side endpoint)
 * Body: { product_id: string, session_id: string }
 */
router.post('/events/add-to-cart', optionalAuthenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { product_id, session_id } = req.body;
        const userAgent = req.get('user-agent') || '';
        const ipAddress = req.ip || req.socket.remoteAddress || '';
        const userId = req.user?.id;

        if (!product_id || !session_id) {
            return res.status(400).json({ error: 'Missing product_id or session_id' });
        }

        const recorded = await EventService.recordEvent(
            product_id,
            session_id,
            'add_to_cart',
            userAgent,
            ipAddress,
            userId
        );

        res.json({ success: recorded });
    } catch (error) {
        console.error('Error recording add-to-cart event:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export const analyticsRouter = router;
export default analyticsRouter;
