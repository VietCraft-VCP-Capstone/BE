import mongoose from 'mongoose';
import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { AiGatewayService, AnalyticsViewer } from '../application/ai-gateway.service';
import { CompetitorTrackingService, TrackingError } from '../application/competitor-tracking.service';
import { Product } from '../../product/infrastructure/models/product.model';
import { BlankClient, Blank } from '../../product/application/blank-client.service';
import { ListingHealthService, HealthStatus } from '../application/listing-health.service';
import { healthSummary } from '../application/listing-health-summary.service';
import { listingRanking } from '../application/listing-ranking.service';
import { parsePreviewBody, PreviewBodyResult } from '../application/health-preview';
import { parseIntelPreview } from '../application/intel-preview';
import { userRateLimit } from '../../../app/middleware/rate-limit.middleware';

type Method = 'get' | 'post' | 'delete';

interface GatewayRoute {
    method: Method;
    path: string;
    ai: (params: Record<string, string>) => string;
    query?: string[];
    forwardShopIdBody?: boolean;
    parseBody?: (raw: unknown) => PreviewBodyResult<Record<string, unknown>>;
}

const ROUTES: GatewayRoute[] = [
    { method: 'get', path: '/listings/intel', ai: () => '/api/analytics/listings/intel' },
    { method: 'get', path: '/listings/:id/intel', ai: p => `/api/analytics/listings/${p.id}/intel`, query: ['date'] },
    { method: 'post', path: '/listings/intel/preview', ai: () => '/api/analytics/listings/intel/preview', parseBody: parseIntelPreview },
    { method: 'get', path: '/trends/calendar', ai: () => '/api/analytics/trends/calendar', query: ['category'] },
    { method: 'get', path: '/overview', ai: () => '/api/analytics/shop/overview', query: ['timeRange'] },
    { method: 'get', path: '/listings/:id/timeseries', ai: p => `/api/analytics/listings/${p.id}/timeseries`, query: ['timeRange'] },
    { method: 'get', path: '/listings/:id/conversion', ai: p => `/api/analytics/listings/${p.id}/conversion` },
    { method: 'post', path: '/listings/:id/health/preview', ai: p => `/api/analytics/listings/${p.id}/health/preview`, parseBody: parsePreviewBody },
    { method: 'get', path: '/listings/:id/health/ml', ai: p => `/api/analytics/listings/${p.id}/health/ml` },
    { method: 'get', path: '/alerts', ai: () => '/api/notifications/alerts', query: ['period'] },
    { method: 'get', path: '/categories', ai: () => '/api/analytics/shop/categories/revenue', query: ['timeRange'] },
    { method: 'get', path: '/competitors', ai: () => '/api/analytics/competitors', query: ['categoryId'] },
    { method: 'get', path: '/shop-comparison', ai: () => '/api/analytics/shop-comparison' },
    { method: 'get', path: '/tag-gap', ai: () => '/api/analytics/tag-gap', query: ['categoryId'] },
    { method: 'get', path: '/pricing', ai: () => '/api/analytics/pricing', query: ['productType', 'price', 'productId'] },
    { method: 'get', path: '/competitor-tracking', ai: () => '/api/analytics/competitor-tracking' },
    { method: 'post', path: '/competitor-tracking', ai: () => '/api/analytics/competitor-tracking', forwardShopIdBody: true },
    { method: 'delete', path: '/competitor-tracking', ai: () => '/api/analytics/competitor-tracking', forwardShopIdBody: true },
    // Dự báo (SRS 3.10)
    { method: 'get', path: '/forecast/revenue', ai: () => '/api/analytics/forecast/revenue', query: ['window'] },
    { method: 'get', path: '/forecast/seasonal', ai: () => '/api/analytics/forecast/seasonal', query: ['categoryId', 'category_slug', 'campaign_id', 'campaignId', 'keyword'] },
    { method: 'get', path: '/forecast/niches', ai: () => '/api/analytics/forecast/niches', query: ['categoryId'] },
    { method: 'get', path: '/forecast/radar', ai: () => '/api/analytics/forecast/radar' },
    { method: 'get', path: '/forecast/recommendations', ai: () => '/api/analytics/forecast/recommendations' },
    // Gợi ý sản phẩm thông minh (F42)
    { method: 'get', path: '/product/smart-suggestion', ai: () => '/api/v1/product/smart-suggestion', query: ['categoryId', 'productType', 'keywords', 'blankCost'] },
    { method: 'post', path: '/product/smart-suggestion', ai: () => '/api/v1/product/smart-suggestion' },
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

async function enrichSeasonalData(data: any, req: AuthenticatedRequest, viewer: AnalyticsViewer) {
    if (!data) return data;

    data.seller_shop_name = viewer.shop_name || 'SNOWKAT';
    data.seller_category = { slug: 'thoi-trang', name: 'Thời trang Nữ & Set may mặc' };
    data.is_live_shop = Boolean(viewer.live_shop_id);

    if (!data.events || !Array.isArray(data.events)) return data;

    let sellerBlanks: Blank[] = [];
    try {
        sellerBlanks = await BlankClient.listBlanks(req.user?.id);
    } catch {
        sellerBlanks = [];
    }

    let shopProducts: any[] = [];
    if (viewer.live_shop_id && mongoose.Types.ObjectId.isValid(viewer.live_shop_id)) {
        try {
            shopProducts = await Product.find({
                shop_id: new mongoose.Types.ObjectId(viewer.live_shop_id),
                listing_status: { $ne: 'EXPIRED' }
            }).select('_id title slug images categories tags product_type original_price stock_alert_threshold').lean();
        } catch {
            shopProducts = [];
        }
    }

    for (const event of data.events) {
        if (event.pod_blanks && Array.isArray(event.pod_blanks)) {
            for (const pb of event.pod_blanks) {
                const bt = (pb.blank_type || '').toLowerCase();
                const matched = sellerBlanks.find(b => {
                    const bId = (b._id || '').toLowerCase();
                    const bCat = (b.category || '').toLowerCase();
                    if (bt.includes('tshirt') || bt.includes('áo')) return bId.includes('tshirt') || bCat.includes('thời trang');
                    if (bt.includes('mug') || bt.includes('cốc') || bt.includes('ly')) return bId.includes('mug') || bCat.includes('gia dụng') || bCat.includes('quà');
                    if (bt.includes('tote') || bt.includes('túi')) return bId.includes('tote') || bCat.includes('phụ kiện');
                    if (bt.includes('canvas') || bt.includes('tranh') || bt.includes('khung')) return bId.includes('frame') || bCat.includes('trang trí');
                    return false;
                });
                if (matched) {
                    pb.matched_blank = {
                        _id: matched._id,
                        title: matched.title,
                        category: matched.category,
                        default_image: matched.default_image,
                        base_cost: matched.variations?.[0]?.base_cost || 0,
                        printer_name: matched.printer_name || 'Xưởng in liên kết',
                        is_connected: true
                    };
                }
            }
        }

        const evName = (event.name || '').toLowerCase();
        const evWords: string[] = evName.split(/\s+/).filter(Boolean);
        event.matching_shop_products = shopProducts.filter((p: any) => {
            const pTitle = (p.title || '').toLowerCase();
            const pTags: string[] = (p.tags || []).map((t: string) => t.toLowerCase());
            const pCats: string[] = (p.categories || []).map((c: string) => c.toLowerCase());
            return evWords.some((w: string) => w.length > 2 && (pTitle.includes(w) || pTags.some((t: string) => t.includes(w)) || pCats.some((c: string) => c.includes(w))));
        }).slice(0, 4);
    }

    data.all_seller_blanks = sellerBlanks.map(b => ({
        _id: b._id,
        title: b.title,
        category: b.category,
        default_image: b.default_image,
        base_cost: b.variations?.[0]?.base_cost || 0,
        printer_name: b.printer_name
    }));

    return data;
}

async function viewerOrReply(req: AuthenticatedRequest, res: Response): Promise<AnalyticsViewer | null> {
    const viewer = await AiGatewayService.resolveViewer(req.user!);
    if (!viewer.analysed_shop_id) {
        res.status(409).json({ error: 'shop_required', message: 'Bạn cần thiết lập gian hàng trước khi xem phân tích.' });
        return null;
    }
    return viewer;
}

/**
 * Thêm / bỏ theo dõi của gian hàng THẬT: BE tự ghi vào follow của sàn, không chuyển sang AI.
 * Service AI chỉ đọc danh sách đó khi trả GET /competitor-tracking.
 */
async function replyLiveTracking(method: Method, userId: string, target: string, viewer: AnalyticsViewer, res: Response) {
    try {
        const data = method === 'post'
            ? await CompetitorTrackingService.track(userId, target)
            : await CompetitorTrackingService.untrack(userId, target);
        return res.json({ data, meta: CompetitorTrackingService.meta(viewer.live_shop_id, data.slots_used), error: null, viewer });
    } catch (error) {
        if (error instanceof TrackingError) return res.status(error.status).json(error.body);
        throw error;
    }
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

router.post('/listings/intel/preview', userRateLimit(20, 60_000, 'Bạn thử quá nhiều lần, vui lòng đợi một phút rồi thử lại.'));

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
            } else if (route.method !== 'get' && req.body && typeof req.body === 'object') {
                body = req.body;
            }

            const viewer = await viewerOrReply(req, res);
            if (!viewer) return;

            // Gian hàng thật theo dõi đối thủ bằng follow của sàn. Chỉ shop mẫu mới chuyển sang
            // service AI (danh sách riêng trong dữ liệu mồi).
            if (route.forwardShopIdBody && !viewer.demo) {
                return await replyLiveTracking(route.method, req.user!.id, String(body!.shop_id), viewer, res);
            }

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

            // Phản hồi thành công giữ nguyên vỏ {data, meta, error} của hợp đồng AI và gắn thêm
            // `viewer`, để mọi màn hình biết đang xem shop thật hay shop mẫu.
            if (result.status < 400 && result.body && result.body.data && route.path === '/forecast/seasonal') {
                await enrichSeasonalData(result.body.data, req, viewer);
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
