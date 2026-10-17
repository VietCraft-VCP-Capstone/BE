import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { AiGatewayService, AnalyticsViewer } from '../application/ai-gateway.service';
import { ListingHealthService, HealthStatus } from '../application/listing-health.service';
import { healthSummary } from '../application/listing-health-summary.service';
import { listingRanking } from '../application/listing-ranking.service';
import { parsePreviewBody, PreviewBodyResult } from '../application/health-preview';

type Method = 'get' | 'post' | 'delete';

interface GatewayRoute {
    method: Method;
    path: string;
    ai: (params: Record<string, string>) => string;
    query?: string[];
    forwardShopIdBody?: boolean;
    parseBody?: (raw: unknown) => PreviewBodyResult;
}

const ROUTES: GatewayRoute[] = [
    { method: 'get', path: '/overview', ai: () => '/api/analytics/shop/overview', query: ['timeRange'] },
    { method: 'get', path: '/listings/:id/timeseries', ai: p => `/api/analytics/listings/${p.id}/timeseries`, query: ['timeRange'] },
    { method: 'get', path: '/listings/:id/conversion', ai: p => `/api/analytics/listings/${p.id}/conversion` },
    { method: 'post', path: '/listings/:id/health/preview', ai: p => `/api/analytics/listings/${p.id}/health/preview`, parseBody: parsePreviewBody },
    { method: 'get', path: '/alerts', ai: () => '/api/notifications/alerts', query: ['period'] },
    { method: 'get', path: '/categories', ai: () => '/api/analytics/shop/categories/revenue', query: ['timeRange'] },
    { method: 'get', path: '/competitors', ai: () => '/api/analytics/competitors', query: ['categoryId'] },
    { method: 'get', path: '/shop-comparison', ai: () => '/api/analytics/shop-comparison' },
    { method: 'get', path: '/tag-gap', ai: () => '/api/analytics/tag-gap', query: ['categoryId'] },
    { method: 'get', path: '/pricing', ai: () => '/api/analytics/pricing', query: ['productType', 'price', 'productId'] },
    { method: 'get', path: '/competitor-tracking', ai: () => '/api/analytics/competitor-tracking' },
    { method: 'post', path: '/competitor-tracking', ai: () => '/api/analytics/competitor-tracking', forwardShopIdBody: true },
    { method: 'delete', path: '/competitor-tracking', ai: () => '/api/analytics/competitor-tracking', forwardShopIdBody: true },
    { method: 'get', path: '/forecast/revenue', ai: () => '/api/analytics/forecast/revenue', query: ['window'] },
    { method: 'get', path: '/forecast/seasonal', ai: () => '/api/analytics/forecast/seasonal', query: ['categoryId', 'keyword'] },
    { method: 'get', path: '/forecast/niches', ai: () => '/api/analytics/forecast/niches', query: ['categoryId'] },
    { method: 'get', path: '/forecast/radar', ai: () => '/api/analytics/forecast/radar' },
    { method: 'get', path: '/forecast/recommendations', ai: () => '/api/analytics/forecast/recommendations' },
];

const MAX_QUERY_LENGTH = 120;

function pickQuery(source: AuthenticatedRequest['query'], allowed: string[] = []): Record<string, string> | null {
    const picked: Record<string, string> = {};
    for (const key of allowed) {
        const value = source[key];
        if (value === undefined || value === '') continue;
        if (typeof value !== 'string' || value.length > MAX_QUERY_LENGTH) return null;
        picked[key] = value;
    }
    return picked;
}

async function viewerOrReply(req: AuthenticatedRequest, res: Response): Promise<AnalyticsViewer | null> {
    const viewer = await AiGatewayService.resolveViewer(req.user!);
    if (!viewer.analysed_shop_id) {
        res.status(409).json({ error: 'shop_required', message: 'Bạn cần thiết lập gian hàng trước khi xem phân tích.' });
        return null;
    }
    return viewer;
}

const router = Router();
router.use(authenticate, requireRole(['seller', 'admin']));

router.get('/context', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const [viewer, reachable] = await Promise.all([
            AiGatewayService.resolveViewer(req.user!),
            AiGatewayService.ping(),
        ]);
        return res.json({ data: { ...viewer, ai_reachable: reachable } });
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Không đọc được thông tin gian hàng.' });
    }
});

const HEALTH_STATUSES: HealthStatus[] = ['good', 'needs_improvement', 'poor'];

router.get('/listings/:id/health', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const viewer = await viewerOrReply(req, res);
        if (!viewer) return;

        const { httpStatus, body } = await ListingHealthService.detail(req.params.id, viewer.analysed_shop_id!);
        const payload = httpStatus < 400 ? { ...body, viewer } : body;
        return res.status(httpStatus).json(payload);
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Lỗi khi đọc điểm sức khoẻ listing.' });
    }
});

const HISTORY_DAYS = [30, 90];

router.get('/listings/:id/health/history', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const days = req.query.days === undefined ? 30 : Number(req.query.days);
        if (!HISTORY_DAYS.includes(days)) {
            return res.status(400).json({ error: 'invalid_param', field: 'days', expected: HISTORY_DAYS.join('|') });
        }

        const viewer = await viewerOrReply(req, res);
        if (!viewer) return;

        const { httpStatus, body } = await ListingHealthService.history(req.params.id, viewer.analysed_shop_id!, days);
        const payload = httpStatus < 400 ? { ...body, viewer } : body;
        return res.status(httpStatus).json(payload);
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Lỗi khi đọc lịch sử điểm sức khoẻ.' });
    }
});

router.get('/listings/health', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const rawStatus = req.query.status;
        let statusFilter: HealthStatus | undefined;
        if (typeof rawStatus === 'string' && rawStatus !== '') {
            if (!HEALTH_STATUSES.includes(rawStatus as HealthStatus)) {
                return res.status(400).json({ error: 'invalid_param', field: 'status', expected: HEALTH_STATUSES.join('|') });
            }
            statusFilter = rawStatus as HealthStatus;
        }

        const viewer = await viewerOrReply(req, res);
        if (!viewer) return;

        const { httpStatus, body } = await ListingHealthService.list(viewer.analysed_shop_id!, statusFilter);
        const payload = httpStatus < 400 ? { ...body, viewer } : body;
        return res.status(httpStatus).json(payload);
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Lỗi khi đọc danh sách sức khoẻ listing.' });
    }
});

router.get('/listings/ranking', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const viewer = await viewerOrReply(req, res);
        if (!viewer) return;
        const { httpStatus, body } = await listingRanking(viewer.analysed_shop_id!);
        return res.status(httpStatus).json({ ...body, viewer });
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Lỗi khi đọc bảng xếp hạng sản phẩm.' });
    }
});

router.get('/listings/health/summary', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const days = req.query.days === undefined ? 30 : Number(req.query.days);
        if (!HISTORY_DAYS.includes(days)) {
            return res.status(400).json({ error: 'invalid_param', field: 'days', expected: HISTORY_DAYS.join('|') });
        }

        const viewer = await viewerOrReply(req, res);
        if (!viewer) return;

        const { httpStatus, body } = await healthSummary(viewer.analysed_shop_id!, days);
        return res.status(httpStatus).json({ ...body, viewer });
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Lỗi khi đọc điểm sức khoẻ của shop.' });
    }
});

for (const route of ROUTES) {
    router[route.method](route.path, async (req: AuthenticatedRequest, res: Response) => {
        try {
            const params: Record<string, string> = {};
            for (const [key, value] of Object.entries(req.params)) {
                if (!AiGatewayService.isValidId(value)) {
                    return res.status(400).json({ error: 'invalid_param', field: key });
                }
                params[key] = value;
            }

            const query = pickQuery(req.query, route.query);
            if (!query) return res.status(400).json({ error: 'invalid_param', field: 'query' });

            let body: Record<string, unknown> | undefined;
            if (route.forwardShopIdBody) {
                const target = req.body?.shop_id;
                if (!AiGatewayService.isValidId(target)) {
                    return res.status(400).json({ error: 'invalid_param', field: 'shop_id' });
                }
                body = { shop_id: target };
            } else if (route.parseBody) {
                const parsed = route.parseBody(req.body);
                if ('invalid' in parsed) return res.status(400).json({ error: 'invalid_param', field: parsed.invalid });
                body = parsed.body;
            }

            const viewer = await viewerOrReply(req, res);
            if (!viewer) return;

            const result = await AiGatewayService.call({
                method: route.method.toUpperCase() as 'GET' | 'POST' | 'DELETE',
                path: route.ai(params),
                shopId: viewer.analysed_shop_id!,
                query,
                body,
            });

            if (result.status === 401) {
                return res.status(502).json({ error: 'ai_gateway_rejected' });
            }

            const payload = result.status < 400 && result.body && typeof result.body === 'object'
                ? { ...result.body, viewer }
                : result.body;
            return res.status(result.status).json(payload);
        } catch (error: any) {
            return res.status(500).json({ error: error?.message || 'Lỗi khi đọc số liệu phân tích.' });
        }
    });
}

export const sellerAnalyticsRouter = router;
export default sellerAnalyticsRouter;
