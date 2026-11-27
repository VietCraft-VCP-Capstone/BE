import mongoose from 'mongoose';
import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { AiGatewayService, AnalyticsViewer } from '../application/ai-gateway.service';
import { CompetitorTrackingService, TrackingError } from '../application/competitor-tracking.service';
import { SeasonalAnalyticsService } from '../application/seasonal-analytics.service';
import { Product } from '../../product/infrastructure/models/product.model';
import ProductsService from '../../product/application/product.service';
import { Tag } from '../../tags';
import { cacheService } from '../../../shared/services/cache.service';
import { ListingHealthService, HealthStatus } from '../application/listing-health.service';
import { healthSummary } from '../application/listing-health-summary.service';
import { searchInsights } from '../application/listing-search-gaps.service';
import { listingImpact, recordHealthAction } from '../application/listing-impact.service';
import { listingRanking } from '../application/listing-ranking.service';
import { parsePreviewBody, PreviewBodyResult } from '../application/health-preview';
import { parseHealthDraft } from '../application/health-draft';
import { userRateLimit } from '../../../app/middleware/rate-limit.middleware';
import { writableShopId } from '../application/seasonal-access';
import { parsePlanRef, PlanRef } from '../application/seasonal-plan';
import { SeasonalPlan } from '../infrastructure/models/seasonal-plan.model';

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
    { method: 'get', path: '/listings/:id/health', ai: p => `/api/analytics/listings/${p.id}/health` },
    { method: 'post', path: '/listings/health/draft', ai: () => '/api/analytics/listings/health/draft', parseBody: parseHealthDraft },
    { method: 'get', path: '/listings/:id/timeseries', ai: p => `/api/analytics/listings/${p.id}/timeseries`, query: ['timeRange'] },
    { method: 'get', path: '/listings/:id/conversion', ai: p => `/api/analytics/listings/${p.id}/conversion` },
    { method: 'post', path: '/listings/:id/health/preview', ai: p => `/api/analytics/listings/${p.id}/health/preview`, parseBody: parsePreviewBody },
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

router.post('/listings/health/draft', userRateLimit(20, 60_000, 'Bạn thử quá nhiều lần, vui lòng đợi một phút rồi thử lại.'));
// Mỗi lần nhận diện ảnh tốn hạn mức Gemini
router.get('/forecast/seasonal', userRateLimit(20, 60_000, 'Bạn tải trang mùa vụ quá nhiều lần, vui lòng đợi một phút rồi thử lại.'));
router.post('/product/recognize-image', userRateLimit(10, 60_000, 'Bạn nhận diện ảnh quá nhiều lần, vui lòng đợi một phút rồi thử lại.'));

const ALLOWED_RATINGS = new Set(['good', 'neutral', 'poor']);
const SAFE_KEY_REGEX = /^[^$\0\r\n]{1,200}$/;
const MAX_SAVED_IDEAS = 200;
const MAX_DRAFTS_OR_REVIEWS = 200;
const MAX_MILESTONES = 1000;

function isSafeKey(value: unknown, maxLen = 200): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLen && SAFE_KEY_REGEX.test(value);
}

function toSafeMapKey(key: string): string {
    return key.replace(/\./g, '_');
}

function replyDemoReadOnly(res: Response) {
    return res.status(403).json({
        success: false,
        error: 'demo_read_only',
        message: 'Bạn đang xem gian hàng mẫu nên không lưu được. Hãy mở gian hàng để lưu kế hoạch của riêng bạn.',
    });
}

// Gắn thẻ từ khóa cơ hội vào các sản phẩm phù hợp của gian hàng
router.post('/forecast/seasonal/attach-tag', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const viewer = await viewerOrReply(req, res);
        if (!viewer) return;
        const cleanTag = typeof req.body?.tag === 'string' ? req.body.tag.trim() : '';
        const rawIds = Array.isArray(req.body?.product_ids) ? req.body.product_ids : [];
        if (!cleanTag || cleanTag.length > 64) {
            return res.status(400).json({ success: false, error: 'invalid_param', field: 'tag' });
        }
        const validIds = rawIds
            .slice(0, 100)
            .filter((id: unknown) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id))
            .map((id: string) => new mongoose.Types.ObjectId(id));
        if (validIds.length === 0) {
            return res.status(400).json({ success: false, error: 'invalid_param', field: 'product_ids' });
        }
        const writableId = writableShopId(viewer);
        if (!writableId) return replyDemoReadOnly(res);

        let tagDoc: { _id: mongoose.Types.ObjectId; name: string } | undefined;
        try {
            const resolved = await ProductsService.resolveProposedTags([cleanTag], req.user!.id);
            tagDoc = resolved.docs[0];
        } catch (e: any) {
            return res.status(400).json({ success: false, error: 'tag_rejected', message: e?.message || 'Thẻ không hợp lệ.' });
        }
        if (!tagDoc) return res.status(400).json({ success: false, error: 'invalid_param', field: 'tag' });
        const shopOid = new mongoose.Types.ObjectId(writableId);
        const needCountUpdate = await Product.countDocuments({
            _id: { $in: validIds },
            shop_id: shopOid,
            tag_ids: { $ne: tagDoc._id },
        });
        const result = await Product.updateMany(
            { _id: { $in: validIds }, shop_id: shopOid },
            { $addToSet: { tags: tagDoc.name, tag_ids: tagDoc._id } }
        );
        const matchedCount = result.matchedCount ?? 0;
        const modifiedCount = result.modifiedCount ?? 0;
        if (matchedCount === 0) {
            return res.status(404).json({ success: false, error: 'no_matching_products', modified_count: 0 });
        }
        if (needCountUpdate > 0) {
            await Tag.updateOne({ _id: tagDoc._id }, { $inc: { product_count: needCountUpdate } });
        }
        await Promise.all([
            ...validIds.map((id: mongoose.Types.ObjectId) => ProductsService.invalidateProductCache(id.toString())),
            cacheService.del('vietcraft:tags:approved'),
            cacheService.del('vietcraft:tags:stats'),
            cacheService.delByPattern('vietcraft:tags:*'),
        ]);
        return res.json({ success: true, modified_count: modifiedCount });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error?.message || 'Lỗi khi gắn thẻ vào sản phẩm.' });
    }
});

// ---- Kế hoạch mùa vụ theo kỳ (dịp + năm): lưu vào collection seasonal_plans ----
// Mọi route ghi đều cần `camp_id` + `event_year` để dữ liệu năm này không lẫn sang năm sau.

async function planContext(req: AuthenticatedRequest, res: Response): Promise<{ shopId: mongoose.Types.ObjectId; ref: PlanRef } | null> {
    const viewer = await viewerOrReply(req, res);
    if (!viewer) return null;
    const writableId = writableShopId(viewer);
    if (!writableId) {
        replyDemoReadOnly(res);
        return null;
    }
    const ref = parsePlanRef(req.body);
    if (!ref) {
        res.status(400).json({ success: false, error: 'invalid_param', field: 'camp_id/event_year' });
        return null;
    }
    return { shopId: new mongoose.Types.ObjectId(writableId), ref };
}

const planFilter = (shopId: mongoose.Types.ObjectId, ref: PlanRef) => ({ shop_id: shopId, event_key: ref.event_key, event_year: ref.event_year });

/** Thêm khóa mới vào map chỉ khi map chưa đạt trần; sửa khóa đã có thì luôn được. */
function planMapCapFilter(shopId: mongoose.Types.ObjectId, ref: PlanRef, map: string, key: string, max: number) {
    return {
        ...planFilter(shopId, ref),
        $or: [
            { [`${map}.${key}`]: { $exists: true } },
            { $expr: { $lt: [{ $size: { $objectToArray: { $ifNull: [`$${map}`, {}] } } }, max] } },
        ],
    };
}

const isDuplicateKey = (e: any) => e?.code === 11000;

/**
 * Tạo kế hoạch của kỳ nếu chưa có, rồi cập nhật theo bộ lọc có điều kiện trần (không upsert,
 * vì điều kiện trần dùng $expr). Trả null khi điều kiện không khớp = đã chạm trần.
 */
async function updatePlan(shopId: mongoose.Types.ObjectId, ref: PlanRef, filter: Record<string, unknown>, update: Record<string, unknown>) {
    const base = planFilter(shopId, ref);
    try {
        await SeasonalPlan.updateOne(base, { $setOnInsert: { saved_ideas: [], idea_drafts: {}, checked_milestones: {}, review: null } }, { upsert: true });
    } catch (e) {
        if (!isDuplicateKey(e)) throw e; // hai request cùng tạo: bản còn lại đã tạo xong
    }
    return SeasonalPlan.findOneAndUpdate(filter, update, { new: true }).lean();
}

// Lưu/Bỏ lưu ý tưởng sản phẩm cho kỳ dịp
router.post('/forecast/seasonal/save-idea', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const ctx = await planContext(req, res);
        if (!ctx) return;
        const { idea_id } = req.body || {};
        if (!isSafeKey(idea_id, 200)) {
            return res.status(400).json({ success: false, error: 'invalid_param', field: 'idea_id' });
        }
        const base = planFilter(ctx.shopId, ctx.ref);
        const existing = await SeasonalPlan.exists({ ...base, saved_ideas: idea_id });
        const updated = existing
            ? await SeasonalPlan.findOneAndUpdate(base, { $pull: { saved_ideas: idea_id } }, { new: true }).lean()
            : await updatePlan(ctx.shopId, ctx.ref,
                { ...base, [`saved_ideas.${MAX_SAVED_IDEAS - 1}`]: { $exists: false } },
                { $addToSet: { saved_ideas: idea_id } },
            );
        if (!updated) return res.status(400).json({ success: false, error: 'saved_ideas_limit_reached' });
        return res.json({ success: true, saved_ideas: updated.saved_ideas || [] });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: 'save_failed', message: 'Lỗi khi lưu ý tưởng theo dịp.' });
    }
});

// Lưu bản chỉnh sửa của seller cho 1 ý tưởng của kỳ dịp
router.post('/forecast/seasonal/idea-draft', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const ctx = await planContext(req, res);
        if (!ctx) return;
        const { idea_id, title, concept, price_vnd, tags } = req.body || {};
        if (!isSafeKey(idea_id, 200)) {
            return res.status(400).json({ success: false, error: 'invalid_param', field: 'idea_id' });
        }
        const parsedPrice = Number(price_vnd);
        const draft = {
            title: typeof title === 'string' ? title.trim().slice(0, 200) : '',
            concept: typeof concept === 'string' ? concept.trim().slice(0, 1000) : '',
            price_vnd: Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : undefined,
            tags: Array.isArray(tags) ? tags.slice(0, 20).map((t: unknown) => String(t).trim().slice(0, 50)).filter(Boolean) : [],
            updated_at: new Date().toISOString(),
        };
        const key = toSafeMapKey(idea_id);
        const updated = await updatePlan(ctx.shopId, ctx.ref,
            planMapCapFilter(ctx.shopId, ctx.ref, 'idea_drafts', key, MAX_DRAFTS_OR_REVIEWS),
            { $set: { [`idea_drafts.${key}`]: draft }, $addToSet: { saved_ideas: idea_id } },
        );
        if (!updated) return res.status(400).json({ success: false, error: 'idea_drafts_limit_reached' });
        return res.json({ success: true, idea_drafts: updated.idea_drafts || {}, saved_ideas: updated.saved_ideas || [] });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: 'save_failed', message: 'Lỗi khi lưu bản chỉnh sửa ý tưởng.' });
    }
});

// Lưu đánh giá thành quả sau dịp của seller (mỗi kỳ một đánh giá)
router.post('/forecast/seasonal/review', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const ctx = await planContext(req, res);
        if (!ctx) return;
        const { rating, note } = req.body || {};
        if (typeof rating !== 'string' || !ALLOWED_RATINGS.has(rating)) {
            return res.status(400).json({ success: false, error: 'invalid_param', field: 'rating' });
        }
        const review = { rating, note: typeof note === 'string' ? note.trim().slice(0, 1000) : '', updated_at: new Date() };
        const updated = await updatePlan(ctx.shopId, ctx.ref, planFilter(ctx.shopId, ctx.ref), { $set: { review } });
        if (!updated) return res.status(409).json({ success: false, error: 'conflict' });
        return res.json({ success: true, occasion_reviews: { [ctx.ref.event_key]: updated.review } });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: 'save_failed', message: 'Lỗi khi lưu đánh giá thành quả.' });
    }
});

// Cập nhật tiến độ checklist mốc thời gian của kỳ dịp
router.post('/forecast/seasonal/milestone', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const ctx = await planContext(req, res);
        if (!ctx) return;
        const { milestone_idx, is_done, idea_id } = req.body || {};
        if (typeof milestone_idx !== 'number' || !Number.isInteger(milestone_idx) || milestone_idx < 0 || milestone_idx > 50) {
            return res.status(400).json({ success: false, error: 'invalid_param', field: 'milestone_idx' });
        }
        if (idea_id !== undefined && idea_id !== null && !isSafeKey(idea_id, 120)) {
            return res.status(400).json({ success: false, error: 'invalid_param', field: 'idea_id' });
        }
        const key = toSafeMapKey(idea_id ? `${idea_id}_${milestone_idx}` : String(milestone_idx));
        const updated = await updatePlan(ctx.shopId, ctx.ref,
            planMapCapFilter(ctx.shopId, ctx.ref, 'checked_milestones', key, MAX_MILESTONES),
            { $set: { [`checked_milestones.${key}`]: Boolean(is_done) } },
        );
        if (!updated) return res.status(400).json({ success: false, error: 'checked_milestones_limit_reached' });
        return res.json({ success: true, checked_milestones: updated.checked_milestones || {} });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: 'save_failed', message: 'Lỗi khi cập nhật tiến độ mốc.' });
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
