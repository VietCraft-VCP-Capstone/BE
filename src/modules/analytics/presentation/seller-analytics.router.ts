import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { AiGatewayService, AnalyticsViewer } from '../application/ai-gateway.service';

type Method = 'get' | 'post' | 'delete';

interface GatewayRoute {
    method: Method;
    path: string;
    ai: (params: Record<string, string>) => string;
    query?: string[];
    forwardShopIdBody?: boolean;
}

const ROUTES: GatewayRoute[] = [
    // Hiệu suất shop (SRS 3.8)
    { method: 'get', path: '/overview', ai: () => '/api/analytics/shop/overview', query: ['timeRange'] },
    { method: 'get', path: '/listings/:id/timeseries', ai: p => `/api/analytics/listings/${p.id}/timeseries`, query: ['timeRange'] },
    { method: 'get', path: '/listings/:id/conversion', ai: p => `/api/analytics/listings/${p.id}/conversion` },
    { method: 'get', path: '/listings/:id/health', ai: p => `/api/analytics/listings/${p.id}/health` },
    { method: 'get', path: '/alerts', ai: () => '/api/notifications/alerts', query: ['period'] },
    { method: 'get', path: '/categories', ai: () => '/api/analytics/shop/categories/revenue', query: ['timeRange'] },
    // Đối thủ (SRS 3.9)
    { method: 'get', path: '/competitors', ai: () => '/api/analytics/competitors', query: ['categoryId'] },
    { method: 'get', path: '/shop-comparison', ai: () => '/api/analytics/shop-comparison' },
    { method: 'get', path: '/tag-gap', ai: () => '/api/analytics/tag-gap', query: ['categoryId'] },
    { method: 'get', path: '/pricing', ai: () => '/api/analytics/pricing', query: ['productType', 'price', 'productId'] },
    { method: 'get', path: '/competitor-tracking', ai: () => '/api/analytics/competitor-tracking' },
    { method: 'post', path: '/competitor-tracking', ai: () => '/api/analytics/competitor-tracking', forwardShopIdBody: true },
    { method: 'delete', path: '/competitor-tracking', ai: () => '/api/analytics/competitor-tracking', forwardShopIdBody: true },
    // Dự báo (SRS 3.10)
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

/** Ai đang xem, đang xem shop nào, service AI có sống không. FE gọi một lần khi vào khu phân tích. */
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

            // AI trả 401 nghĩa là BE và AI lệch AI_GATEWAY_SECRET — lỗi cấu hình phía máy chủ,
            // không phải phiên của người bán. Chuyển nguyên 401 về thì interceptor FE sẽ
            // đăng xuất người bán dù token của họ vẫn hợp lệ.
            if (result.status === 401) {
                return res.status(502).json({ error: 'ai_gateway_rejected' });
            }

            // Phản hồi thành công giữ nguyên vỏ {data, meta, error} của hợp đồng AI và gắn thêm
            // `viewer`, để mọi màn hình biết đang xem shop thật hay shop mẫu.
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
