import mongoose from 'mongoose';
import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { AiGatewayService, AnalyticsViewer } from '../application/ai-gateway.service';
import { CompetitorTrackingService, TrackingError } from '../application/competitor-tracking.service';
import { SeasonalAnalyticsService } from '../application/seasonal-analytics.service';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { Product } from '../../product/infrastructure/models/product.model';
import ProductsService from '../../product/application/product.service';
import { Tag } from '../../tags';
import { cacheService } from '../../../shared/services/cache.service';
import { generateSlug } from '../../../shared/utils/slug';
import { ListingHealthService, HealthStatus } from '../application/listing-health.service';
import { healthSummary } from '../application/listing-health-summary.service';
import { searchInsights } from '../application/listing-search-gaps.service';
import { listingImpact, recordHealthAction } from '../application/listing-impact.service';
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
    timeoutMs?: number;
}

/**
  Chỉ chuyển tiếp ảnh: `images` (tối đa 6 ảnh cùng sản phẩm, các màu khác nhau) hoặc `image_base64` (1 ảnh,
  client cũ). Tổng base64 ≤ ~12MB để dưới giới hạn 15MB của express.json; AI kiểm tra lại là ảnh thật.
 */
function parseRecognizeImage(raw: unknown): PreviewBodyResult<Record<string, unknown>> {
    const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const images = Array.isArray(b.images) ? b.images : (typeof b.image_base64 === 'string' ? [b.image_base64] : []);
    if (images.length === 0 || images.length > 6 || images.some(x => typeof x !== 'string' || !x)) {
        return { invalid: 'images' };
    }
    if ((images as string[]).reduce((n, x) => n + x.length, 0) > 12_000_000) return { invalid: 'images' };
    const mime = typeof b.mime_type === 'string' ? b.mime_type.slice(0, 40) : undefined;
    return { body: { images, ...(mime ? { mime_type: mime } : {}) } };
}

const ROUTES: GatewayRoute[] = [
    { method: 'get', path: '/overview', ai: () => '/api/analytics/shop/overview', query: ['timeRange', 'to'] },
    { method: 'get', path: '/listings/intel', ai: () => '/api/analytics/listings/intel' },
    { method: 'get', path: '/listings/:id/intel', ai: p => `/api/analytics/listings/${p.id}/intel`, query: ['date'] },
    { method: 'get', path: '/listings/:id/health', ai: p => `/api/analytics/listings/${p.id}/health` },
    { method: 'post', path: '/listings/intel/preview', ai: () => '/api/analytics/listings/intel/preview', parseBody: parseIntelPreview },
    { method: 'get', path: '/trends/calendar', ai: () => '/api/analytics/trends/calendar', query: ['category'] },
    { method: 'get', path: '/listings/:id/timeseries', ai: p => `/api/analytics/listings/${p.id}/timeseries`, query: ['timeRange'] },
    { method: 'get', path: '/listings/:id/conversion', ai: p => `/api/analytics/listings/${p.id}/conversion` },
    { method: 'post', path: '/listings/:id/health/preview', ai: p => `/api/analytics/listings/${p.id}/health/preview`, parseBody: parsePreviewBody },
    { method: 'get', path: '/listings/:id/health/ml', ai: p => `/api/analytics/listings/${p.id}/health/ml` },
    { method: 'get', path: '/listings/:id/quality', ai: p => `/api/analytics/listings/${p.id}/quality` },
    { method: 'post', path: '/listings/:id/quality/audit', ai: p => `/api/analytics/listings/${p.id}/quality/audit` },
    { method: 'post', path: '/listings/:id/quality/recheck', ai: p => `/api/analytics/listings/${p.id}/quality/recheck` },
    { method: 'get', path: '/alerts', ai: () => '/api/notifications/alerts', query: ['period'] },
    { method: 'get', path: '/money', ai: () => '/api/analytics/shop/money', query: ['timeRange', 'from_date', 'to_date'] },
    { method: 'get', path: '/money/advice', ai: () => '/api/analytics/shop/money/advice', query: ['timeRange', 'from_date', 'to_date'] },
    { method: 'get', path: '/competitors', ai: () => '/api/analytics/competitors', query: ['categoryId'] },
    { method: 'get', path: '/competitor-brief', ai: () => '/api/analytics/competitor-brief' },
    { method: 'get', path: '/shop-comparison', ai: () => '/api/analytics/shop-comparison' },
    { method: 'get', path: '/tag-gap', ai: () => '/api/analytics/tag-gap', query: ['categoryId'] },
    { method: 'get', path: '/pricing', ai: () => '/api/analytics/pricing', query: ['productType', 'price', 'productId'] },
    { method: 'get', path: '/competitor-tracking', ai: () => '/api/analytics/competitor-tracking' },
    { method: 'post', path: '/competitor-tracking', ai: () => '/api/analytics/competitor-tracking', forwardShopIdBody: true },
    { method: 'delete', path: '/competitor-tracking', ai: () => '/api/analytics/competitor-tracking', forwardShopIdBody: true },
    { method: 'delete', path: '/competitor-tracking/:shopId', ai: p => `/api/analytics/competitor-tracking/${p.shopId}`, forwardShopIdBody: true },
    // Dự báo (SRS 3.10)
    { method: 'get', path: '/forecast/seasonal', ai: () => '/api/analytics/forecast/seasonal', query: ['categoryId', 'category_slug', 'campaign_id', 'campaignId', 'keyword'] },
    // Gợi ý sản phẩm thông minh (F42)
    // timeoutMs cao hơn mặc định: lần gọi đầu tiên sau khi AI service khởi động lại phải fit TF-IDF ~45k dòng, có thể chậm hơn bình thường
    { method: 'get', path: '/product/smart-suggestion', ai: () => '/api/v1/product/smart-suggestion', query: ['categoryId', 'categoryName', 'productType', 'keywords', 'title', 'blankCost', 'targetMargin', 'material'], timeoutMs: 45_000 },
    { method: 'post', path: '/product/smart-suggestion', ai: () => '/api/v1/product/smart-suggestion', timeoutMs: 45_000 },
    // Nhận diện sản phẩm từ ảnh (F42): ảnh base64 do FE đã thu nhỏ
    { method: 'post', path: '/product/recognize-image', ai: () => '/api/v1/product/recognize-image', parseBody: parseRecognizeImage, timeoutMs: 45_000 },   // đọc ảnh có thể ~40s khi phải đổi model
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

// Toàn bộ nghiệp vụ Seasonal & Gemini AI Advisory đã được tách thành SeasonalAnalyticsService

async function viewerOrReply(req: AuthenticatedRequest, res: Response): Promise<AnalyticsViewer | null> {
    const viewer = await AiGatewayService.resolveViewer(req.user!);
    if (!viewer.analysed_shop_id) {
        res.status(409).json({ error: 'shop_required', message: 'Bạn cần thiết lập gian hàng trước khi xem phân tích.' });
        return null;
    }
    return viewer;
}

// Gian hàng thật: BE ghi follow của sàn, AI chỉ đọc lại khi GET /competitor-tracking.
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

const SHOP_SEARCH_MAX = 60;

router.get('/competitor-tracking/categories', async (_req: AuthenticatedRequest, res: Response) => {
    try {
        return res.json({ data: await CompetitorTrackingService.rootCategories() });
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Lỗi khi đọc danh mục.' });
    }
});

router.get('/competitor-tracking/search', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : '';
        // Tìm theo tên, theo danh mục, hoặc cả hai; phải có ít nhất một.
        if (q.length > SHOP_SEARCH_MAX || (!q && !categoryId)) {
            return res.status(400).json({ error: 'invalid_param', field: 'q', expected: `1-${SHOP_SEARCH_MAX} ký tự` });
        }
        if (categoryId && !/^[a-f0-9]{24}$/i.test(categoryId)) {
            return res.status(400).json({ error: 'invalid_param', field: 'categoryId' });
        }
        const viewer = await viewerOrReply(req, res);
        if (!viewer) return;
        // Shop mẫu theo dõi bằng mã shp_* của dữ liệu mồi, không tìm trên sàn.
        if (viewer.demo) return res.json({ data: [], viewer });
        const data = await CompetitorTrackingService.searchShops(req.user!.id, q, categoryId || undefined);
        return res.json({ data, viewer });
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Lỗi khi tìm gian hàng.' });
    }
});

const HEALTH_STATUSES: HealthStatus[] = ['good', 'needs_improvement', 'poor'];

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
        return res.status(500).json({ error: error?.message || 'Lỗi khi đọc lịch sử độ hoàn thiện trang sản phẩm.' });
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
        return res.status(500).json({ error: error?.message || 'Lỗi khi đọc danh sách tối ưu sản phẩm.' });
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

router.get('/listings/:id/search-insights', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const viewer = await viewerOrReply(req, res);
        if (!viewer) return;
        const { httpStatus, body } = await searchInsights(req.params.id, viewer.analysed_shop_id!);
        return res.status(httpStatus).json(httpStatus < 400 ? { ...body, viewer } : body);
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Lỗi khi đọc từ khoá khách tìm.' });
    }
});

router.get('/listings/:id/impact', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const viewer = await viewerOrReply(req, res);
        if (!viewer) return;
        const { httpStatus, body } = await listingImpact(req.params.id, viewer.analysed_shop_id!);
        return res.status(httpStatus).json(httpStatus < 400 ? { ...body, viewer } : body);
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Lỗi khi đọc tác động thay đổi nội dung.' });
    }
});

router.post('/listings/:id/health/actions', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const viewer = await viewerOrReply(req, res);
        if (!viewer) return;
        const { httpStatus, body } = await recordHealthAction(req.params.id, viewer.analysed_shop_id!, req.user!.id, req.body);
        return res.status(httpStatus).json(httpStatus < 400 ? { ...body, viewer } : body);
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Lỗi khi ghi nhận thao tác độ hoàn thiện trang sản phẩm.' });
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
        return res.status(500).json({ error: error?.message || 'Lỗi khi đọc độ hoàn thiện trang sản phẩm của shop.' });
    }
});

router.post('/listings/intel/preview', userRateLimit(20, 60_000, 'Bạn thử quá nhiều lần, vui lòng đợi một phút rồi thử lại.'));
// Mỗi lần nhận diện ảnh tốn hạn mức Gemini
router.post('/product/recognize-image', userRateLimit(10, 60_000, 'Bạn nhận diện ảnh quá nhiều lần, vui lòng đợi một phút rồi thử lại.'));

// Gắn thẻ từ khóa cơ hội vào các sản phẩm phù hợp của gian hàng
router.post('/forecast/seasonal/attach-tag', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const viewer = await viewerOrReply(req, res);
        if (!viewer) return;
        const cleanTag = typeof req.body?.tag === 'string' ? req.body.tag.trim() : '';
        const rawIds = Array.isArray(req.body?.product_ids) ? req.body.product_ids : [];
        if (!cleanTag) {
            return res.status(400).json({ error: 'invalid_param', field: 'tag' });
        }
        const validIds = rawIds
            .filter((id: unknown) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id))
            .map((id: string) => new mongoose.Types.ObjectId(id));
        if (viewer.live_shop_id && mongoose.Types.ObjectId.isValid(viewer.live_shop_id) && validIds.length > 0) {
            const slug = generateSlug(cleanTag) || cleanTag.toLowerCase().replace(/\s+/g, '-');
            let tagDoc = await Tag.findOne({ $or: [{ slug }, { name: cleanTag }] });
            if (!tagDoc) {
                tagDoc = await Tag.create({
                    name: cleanTag,
                    slug,
                    status: 'active',
                    review_status: 'approved',
                    product_count: 0,
                });
            }
            const shopOid = new mongoose.Types.ObjectId(viewer.live_shop_id);
            const needCountUpdate = await Product.countDocuments({
                _id: { $in: validIds },
                shop_id: shopOid,
                tag_ids: { $ne: tagDoc._id },
            });
            const result = await Product.updateMany(
                { _id: { $in: validIds }, shop_id: shopOid },
                { $addToSet: { tags: cleanTag, tag_ids: tagDoc._id } }
            );
            if (needCountUpdate > 0) {
                await Tag.updateOne({ _id: tagDoc._id }, { $inc: { product_count: needCountUpdate } });
            }
            await Promise.all([
                ...validIds.map((id: mongoose.Types.ObjectId) => ProductsService.invalidateProductCache(id.toString())),
                cacheService.del('vietcraft:tags:approved'),
                cacheService.del('vietcraft:tags:stats'),
                cacheService.delByPattern('vietcraft:tags:*'),
            ]);
            return res.json({ success: true, modified_count: result.modifiedCount ?? result.matchedCount ?? 0 });
        }
        return res.json({ success: true, modified_count: 0 });
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Lỗi khi gắn thẻ vào sản phẩm.' });
    }
});

// Lưu/Bỏ lưu ý tưởng sản phẩm theo dịp (lưu trực tiếp vào settings gian hàng)
router.post('/forecast/seasonal/save-idea', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const viewer = await viewerOrReply(req, res);
        if (!viewer) return;
        const { idea_id } = req.body;
        if (!idea_id || typeof idea_id !== 'string') {
            return res.status(400).json({ error: 'invalid_param', field: 'idea_id' });
        }
        if (viewer.analysed_shop_id && mongoose.Types.ObjectId.isValid(viewer.analysed_shop_id)) {
            const shopDoc = await Shop.findById(viewer.analysed_shop_id);
            if (shopDoc) {
                shopDoc.settings = shopDoc.settings || {};
                shopDoc.settings.seasonal_preferences = shopDoc.settings.seasonal_preferences || {};
                const current: string[] = shopDoc.settings.seasonal_preferences.saved_ideas || [];
                const idx = current.indexOf(idea_id);
                if (idx > -1) {
                    current.splice(idx, 1);
                } else {
                    current.push(idea_id);
                }
                shopDoc.settings.seasonal_preferences.saved_ideas = current;
                shopDoc.markModified('settings');
                await shopDoc.save();
                return res.json({ success: true, saved_ideas: current });
            }
        }
        return res.json({ success: true, saved_ideas: [idea_id] });
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Lỗi khi lưu ý tưởng theo dịp.' });
    }
});

// Lưu bản chỉnh sửa trực tiếp của seller cho 1 ý tưởng mùa vụ
router.post('/forecast/seasonal/idea-draft', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const viewer = await viewerOrReply(req, res);
        if (!viewer) return;
        const { idea_id, title, concept, price_vnd, tags } = req.body || {};
        if (!idea_id || typeof idea_id !== 'string') {
            return res.status(400).json({ error: 'invalid_param', field: 'idea_id' });
        }
        if (viewer.analysed_shop_id && mongoose.Types.ObjectId.isValid(viewer.analysed_shop_id)) {
            const shopDoc = await Shop.findById(viewer.analysed_shop_id);
            if (shopDoc) {
                shopDoc.settings = shopDoc.settings || {};
                shopDoc.settings.seasonal_preferences = shopDoc.settings.seasonal_preferences || {};
                const drafts = shopDoc.settings.seasonal_preferences.idea_drafts || {};
                drafts[idea_id] = {
                    title: typeof title === 'string' ? title.trim() : '',
                    concept: typeof concept === 'string' ? concept.trim() : '',
                    price_vnd: Number(price_vnd) > 0 ? Number(price_vnd) : undefined,
                    tags: Array.isArray(tags) ? tags.map((t: unknown) => String(t).trim()).filter(Boolean) : [],
                    updated_at: new Date().toISOString(),
                };
                shopDoc.settings.seasonal_preferences.idea_drafts = drafts;
                const saved: string[] = shopDoc.settings.seasonal_preferences.saved_ideas || [];
                if (!saved.includes(idea_id)) {
                    saved.push(idea_id);
                    shopDoc.settings.seasonal_preferences.saved_ideas = saved;
                }
                shopDoc.markModified('settings');
                await shopDoc.save();
                return res.json({ success: true, idea_drafts: drafts, saved_ideas: saved });
            }
        }
        return res.json({ success: true, idea_drafts: {} });
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Lỗi khi lưu bản chỉnh sửa ý tưởng.' });
    }
});

// Lưu đánh giá thành quả sau dịp của seller
router.post('/forecast/seasonal/review', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const viewer = await viewerOrReply(req, res);
        if (!viewer) return;
        const { camp_id, rating, note } = req.body || {};
        if (!camp_id || typeof camp_id !== 'string') {
            return res.status(400).json({ error: 'invalid_param', field: 'camp_id' });
        }
        if (viewer.analysed_shop_id && mongoose.Types.ObjectId.isValid(viewer.analysed_shop_id)) {
            const shopDoc = await Shop.findById(viewer.analysed_shop_id);
            if (shopDoc) {
                shopDoc.settings = shopDoc.settings || {};
                shopDoc.settings.seasonal_preferences = shopDoc.settings.seasonal_preferences || {};
                const reviews = shopDoc.settings.seasonal_preferences.occasion_reviews || {};
                reviews[camp_id] = {
                    rating: typeof rating === 'string' ? rating : 'neutral',
                    note: typeof note === 'string' ? note.trim() : '',
                    updated_at: new Date().toISOString(),
                };
                shopDoc.settings.seasonal_preferences.occasion_reviews = reviews;
                shopDoc.markModified('settings');
                await shopDoc.save();
                return res.json({ success: true, occasion_reviews: reviews });
            }
        }
        return res.json({ success: true, occasion_reviews: {} });
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Lỗi khi lưu đánh giá thành quả.' });
    }
});

// Cập nhật tiến độ checklist mốc thời gian (lưu trực tiếp vào settings gian hàng)
router.post('/forecast/seasonal/milestone', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const viewer = await viewerOrReply(req, res);
        if (!viewer) return;
        const { milestone_idx, is_done, camp_id } = req.body;
        if (typeof milestone_idx !== 'number') {
            return res.status(400).json({ error: 'invalid_param', field: 'milestone_idx' });
        }
        if (viewer.analysed_shop_id && mongoose.Types.ObjectId.isValid(viewer.analysed_shop_id)) {
            const shopDoc = await Shop.findById(viewer.analysed_shop_id);
            if (shopDoc) {
                shopDoc.settings = shopDoc.settings || {};
                shopDoc.settings.seasonal_preferences = shopDoc.settings.seasonal_preferences || {};
                const currentMilestones = shopDoc.settings.seasonal_preferences.checked_milestones || {};
                const key = camp_id ? `${camp_id}_${milestone_idx}` : String(milestone_idx);
                currentMilestones[key] = Boolean(is_done);
                shopDoc.settings.seasonal_preferences.checked_milestones = currentMilestones;
                shopDoc.markModified('settings');
                await shopDoc.save();
                return res.json({ success: true, checked_milestones: currentMilestones });
            }
        }
        return res.json({ success: true, checked_milestones: { [milestone_idx]: Boolean(is_done) } });
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Lỗi khi cập nhật tiến độ mốc.' });
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
                const target = req.params.shopId ?? req.body?.shop_id;
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

            // Gian hàng thật theo dõi bằng follow của sàn; chỉ shop mẫu mới gọi AI.
            if (route.forwardShopIdBody && !viewer.demo) {
                return await replyLiveTracking(route.method, req.user!.id, String(body!.shop_id), viewer, res);
            }

            const result = await AiGatewayService.call({
                method: route.method.toUpperCase() as 'GET' | 'POST' | 'DELETE',
                path: route.ai(params),
                shopId: viewer.analysed_shop_id!,
                query,
                body,
                timeoutMs: route.timeoutMs,
            });

            if (result.status === 401) {
                return res.status(502).json({ error: 'ai_gateway_rejected' });
            }

            // Phản hồi thành công giữ nguyên vỏ {data, meta, error} của hợp đồng AI và gắn thêm
            // `viewer`, để mọi màn hình biết đang xem shop thật hay shop mẫu.
            if (result.status < 400 && result.body && result.body.data && route.path === '/forecast/seasonal') {
                await SeasonalAnalyticsService.enrichSeasonalData(result.body.data, req, viewer);
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
