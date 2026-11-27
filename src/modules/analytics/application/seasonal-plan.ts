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
    checked_milestones: Record<string, boolean>;
    review: { rating: string; note: string; updated_at?: string } | null;
    source: 'plan' | 'legacy' | 'empty';
}

/**
 * Dữ liệu kế hoạch hiển thị cho một kỳ. Ưu tiên kế hoạch đúng kỳ; chưa có thì chỉ mượn
 * ý tưởng/bản nháp cũ trong Shop.settings (dữ liệu cũ không có năm). Đánh giá và mốc cũ không mượn,
 * vì chúng gắn với một kỳ cụ thể đã qua.
 */
export function planViewFor(
    plans: Map<string, any>,
    eventKey: string,
    eventYear: number | null,
    legacy: { saved_ideas?: string[]; idea_drafts?: Record<string, any> } | null,
): PlanView {
    const plan = eventYear != null ? plans.get(planLookupKey(eventKey, eventYear)) : undefined;
    if (plan) {
        return {
            saved_ideas: Array.isArray(plan.saved_ideas) ? plan.saved_ideas : [],
            idea_drafts: plan.idea_drafts || {},
            checked_milestones: plan.checked_milestones || {},
            review: plan.review && plan.review.rating ? plan.review : null,
            source: 'plan',
        };
    }
    const hasLegacy = Boolean(legacy && ((legacy.saved_ideas || []).length || Object.keys(legacy.idea_drafts || {}).length));
    return {
        saved_ideas: hasLegacy ? legacy!.saved_ideas || [] : [],
        idea_drafts: hasLegacy ? legacy!.idea_drafts || {} : {},
        checked_milestones: {},
        review: null,
        source: hasLegacy ? 'legacy' : 'empty',
    };
}
