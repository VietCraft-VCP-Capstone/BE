import { createHash } from 'crypto';
// Kế hoạch mùa vụ của shop theo từng kỳ (dịp + năm của ngày lễ): ý tưởng đã lưu, bản nháp, mốc, đánh giá.
// Các hàm thuần ở đây không đụng DB để kiểm thử được.

const SAFE_KEY = /^[A-Za-z0-9_/\-]{1,40}$/;

export interface PlanRef {
    event_key: string;
    event_year: number;
}

/** Đọc `camp_id` + `event_year` từ body; null nếu thiếu hoặc không hợp lệ. */
export function parsePlanRef(body: any): PlanRef | null {
    const key = typeof body?.camp_id === 'string' ? body.camp_id.trim() : '';
    const year = Number(body?.event_year);
    if (!SAFE_KEY.test(key)) return null;
    if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
    return { event_key: key, event_year: year };
}

/** Năm của kỳ dịp = năm của ngày lễ kỳ đó (dịp Noel 2026 vẫn là 2026 dù đang xem vào tháng 1/2027). */
export function eventYearOf(camp: any): number | null {
    const iso = camp?.occasion_window?.event_date || camp?.launch_window?.peak_date || camp?.event_date;
    const y = typeof iso === 'string' ? Number(iso.slice(0, 4)) : NaN;
    return Number.isInteger(y) ? y : null;
}

export const planLookupKey = (eventKey: string, eventYear: number): string => `${eventKey}@${eventYear}`;

export interface PlanView {
    saved_ideas: string[];
    idea_drafts: Record<string, any>;
    idea_snapshots: Record<string, any>;
    checked_milestones: Record<string, boolean>;
    review: { rating: string; note: string; updated_at?: string } | null;
    /** đánh giá riêng từng ý tưởng đã áp dụng, theo ID gốc của ý tưởng */
    idea_reviews: Record<string, IdeaReview>;
    source: 'plan' | 'legacy' | 'empty';
}

export type ReviewRating = 'good' | 'neutral' | 'poor';
export interface IdeaReview { rating: ReviewRating; note: string; updated_at?: Date | string }

const RATINGS = new Set<string>(['good', 'neutral', 'poor']);
const MAX_IDEA_REVIEWS = 30;
const IDEA_NOTE_MAX = 300;
const REVIEW_IDEA_ID = /^[A-Za-z0-9_/.\-]{1,200}$/;

export type ReviewBody =
    | { review: { rating: ReviewRating; note: string; updated_at: Date } | null; idea_reviews: Record<string, IdeaReview>; invalid?: undefined }
    | { invalid: 'rating' | 'idea_reviews' };

/**
 * Body lưu đánh giá sau dịp: đánh giá chung (không bắt buộc) + đánh giá từng ý tưởng. Cần ít nhất một mức.
 * Ý tưởng chưa chọn mức thì bỏ qua; khóa map đổi "." thành "_" vì Mongo không cho "." trong khóa.
 */
export function parseReviewBody(body: any): ReviewBody {
    const now = new Date();
    const rawRating = body?.rating;
    if (rawRating != null && (typeof rawRating !== 'string' || !RATINGS.has(rawRating))) return { invalid: 'rating' };
    const review = rawRating
        ? { rating: rawRating as ReviewRating, note: typeof body?.note === 'string' ? body.note.trim().slice(0, 1000) : '', updated_at: now }
        : null;

    const raw = body?.idea_reviews;
    if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) return { invalid: 'idea_reviews' };
    const entries = Object.entries(raw || {});
    if (entries.length > MAX_IDEA_REVIEWS) return { invalid: 'idea_reviews' };
    const ideaReviews: Record<string, IdeaReview> = {};
    for (const [id, v] of entries) {
        if (!REVIEW_IDEA_ID.test(id)) return { invalid: 'idea_reviews' };
        const r = (v as any)?.rating;
        if (r == null) continue;
        if (typeof r !== 'string' || !RATINGS.has(r)) return { invalid: 'idea_reviews' };
        const note = typeof (v as any)?.note === 'string' ? (v as any).note.trim().slice(0, IDEA_NOTE_MAX) : '';
        ideaReviews[safeMapKey(id)] = { rating: r as ReviewRating, note, updated_at: now };
    }
    if (!review && Object.keys(ideaReviews).length === 0) return { invalid: 'rating' };
    return { review, idea_reviews: ideaReviews };
}

/**
 * Dữ liệu kế hoạch hiển thị cho một kỳ. Ưu tiên kế hoạch đúng kỳ; chưa có thì chỉ mượn
 * ý tưởng/bản nháp cũ trong Shop.settings (dữ liệu cũ không có năm). Đánh giá và mốc cũ không mượn,
 * vì chúng gắn với một kỳ cụ thể đã qua.
 */
/** Khóa map trong Mongo không được chứa "." nên route lưu dưới khóa đã thay "." bằng "_". */
export const safeMapKey = (key: string): string => key.replace(/\./g, '_');

/** Trả map theo ID gốc của các ý tưởng đã lưu (khóa trong DB có thể là bản đã thay "."). */
function rekeyBySavedIds(map: Record<string, any> | undefined, savedIds: string[]): Record<string, any> {
    const out: Record<string, any> = { ...(map || {}) };
    for (const id of savedIds) {
        const safe = safeMapKey(id);
        if (out[id] === undefined && out[safe] !== undefined) out[id] = out[safe];
    }
    return out;
}

/**
 * Ý tưởng kiểu cũ (Shop.settings, không có năm) chỉ thuộc đúng dịp ghi trong ID `ai_idea_<dịp>_<n>`.
 * ID không mang dịp (kw_..., ready-...) không biết thuộc dịp nào nên không mượn sang kế hoạch nào.
 */
export function legacyForCamp(
    legacy: { saved_ideas?: string[]; idea_drafts?: Record<string, any> } | null | undefined,
    campId: string,
): { saved_ideas: string[]; idea_drafts: Record<string, any> } {
    const prefix = `ai_idea_${campId}_`;
    const saved = (legacy?.saved_ideas || []).filter(id => id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length)));
    const drafts: Record<string, any> = {};
    for (const id of saved) {
        const d = legacy?.idea_drafts?.[id] ?? legacy?.idea_drafts?.[safeMapKey(id)];
        if (d !== undefined) drafts[id] = d;
    }
    return { saved_ideas: saved, idea_drafts: drafts };
}

/** Đánh giá từng ý tưởng (khóa đã thay ".") trả theo ID gốc; bỏ mục không có mức hợp lệ. */
export function ideaReviewsBySavedIds(map: Record<string, any> | undefined, savedIds: string[]): Record<string, IdeaReview> {
    const out: Record<string, IdeaReview> = {};
    for (const [k, v] of Object.entries(rekeyBySavedIds(map, savedIds))) {
        if (v && RATINGS.has(v.rating)) out[k] = v;
    }
    return out;
}

export function planViewFor(
    plans: Map<string, any>,
    eventKey: string,
    eventYear: number | null,
    legacy: { saved_ideas?: string[]; idea_drafts?: Record<string, any> } | null,
): PlanView {
    const plan = eventYear != null ? plans.get(planLookupKey(eventKey, eventYear)) : undefined;
    if (plan) {
        const saved: string[] = Array.isArray(plan.saved_ideas) ? plan.saved_ideas : [];
        return {
            saved_ideas: saved,
            idea_drafts: rekeyBySavedIds(plan.idea_drafts, saved),
            idea_snapshots: rekeyBySavedIds(plan.idea_snapshots, saved),
            checked_milestones: plan.checked_milestones || {},
            review: plan.review && plan.review.rating ? plan.review : null,
            idea_reviews: ideaReviewsBySavedIds(plan.idea_reviews, saved),
            source: 'plan',
        };
    }
    const own = legacyForCamp(legacy, eventKey);
    const hasLegacy = own.saved_ideas.length > 0;
    return {
        saved_ideas: own.saved_ideas,
        idea_drafts: own.idea_drafts,
        idea_snapshots: {},
        checked_milestones: {},
        review: null,
        idea_reviews: {},
        source: hasLegacy ? 'legacy' : 'empty',
    };
}

/**
 * ID ý tưởng theo nội dung, cùng công thức với `stable_id` phía AI (app/core/seasonal_keyword_pool.py):
 * `<loại>_<dịp>_<sha1(tên chuẩn hóa)[:10]>`. Không theo vị trí nên danh sách đổi thứ tự không làm trỏ nhầm.
 */
export function stableIdeaId(prefix: string, campId: string, text: string): string {
    const norm = (s: string) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const camp = norm(campId).replace(/[^a-z0-9_-]/g, '-');
    const digest = createHash('sha1').update(norm(text), 'utf8').digest('hex').slice(0, 10);
    return `${prefix}_${camp}_${digest}`;
}

export interface IdeaSnapshot {
    title: string;
    kind: 'ai' | 'ready' | 'pod' | 'keyword';
    keyword?: string;
    price_vnd?: number;
    source?: string;
}

const IDEA_KINDS = new Set(['ai', 'ready', 'pod', 'keyword']);

/**
 * Bản chụp nội dung ý tưởng lúc seller lưu. Danh sách ý tưởng đổi theo dữ liệu thị trường hằng ngày,
 * nên kế hoạch phải giữ nội dung của chính ý tưởng đã chọn thay vì chỉ giữ ID.
 */
export function parseIdeaSnapshot(raw: any): IdeaSnapshot | null {
    if (!raw || typeof raw !== 'object') return null;
    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 200) : '';
    if (!title || !IDEA_KINDS.has(raw.kind)) return null;
    const price = Number(raw.price_vnd);
    const snap: IdeaSnapshot = { title, kind: raw.kind };
    if (typeof raw.keyword === 'string' && raw.keyword.trim()) snap.keyword = raw.keyword.trim().slice(0, 80);
    if (Number.isFinite(price) && price > 0) snap.price_vnd = Math.round(price);
    if (typeof raw.source === 'string' && raw.source.trim()) snap.source = raw.source.trim().slice(0, 80);
    return snap;
}

const IDEA_ID = /^[A-Za-z0-9_/\-]{1,200}$/;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export type LinkProductBody =
    | { idea_id: string; product_id: string; linked: boolean; invalid?: undefined }
    | { invalid: 'idea_id' | 'product_id' };

/** Body của route gắn/bỏ gắn một sản phẩm có sẵn của shop vào ý tưởng mùa vụ. */
export function parseLinkProductBody(body: any): LinkProductBody {
    const ideaId = typeof body?.idea_id === 'string' ? body.idea_id.trim() : '';
    if (!IDEA_ID.test(ideaId)) return { invalid: 'idea_id' };
    const productId = typeof body?.product_id === 'string' ? body.product_id.trim() : '';
    if (!OBJECT_ID.test(productId)) return { invalid: 'product_id' };
    return { idea_id: ideaId, product_id: productId, linked: body?.linked !== false };
}
