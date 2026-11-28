import { isValidDemandOrder } from './seasonal-math';

// Thành quả của từng ý tưởng mùa vụ: ý tưởng → sản phẩm tạo/gắn từ ý tưởng (product.source_idea_id) → đơn thật trong kỳ dịp.
// Chỉ khớp theo source_idea_id, không đoán theo tên sản phẩm.

export type IdeaStage = 'idea' | 'listed' | 'selling';

export interface IdeaOutcome {
    idea_id: string;
    title: string;
    kind: string | null;
    saved: boolean;
    stage: IdeaStage;
    products: Array<{ id: string; title: string }>;
    orders: number;
    units: number;
    revenue: number;
}

export interface IdeaOutcomeReport {
    items: IdeaOutcome[];
    totals: {
        ideas_saved: number;
        ideas_listed: number;
        ideas_selling: number;
        orders: number;
        units: number;
        revenue: number;
        shop_orders_in_window: number;
        share_of_shop_orders_pct: number | null;
    };
    window: { start: string; end: string };
}

const num = (v: any): number => {
    const n = Number(v?.toString?.() ?? v);
    return Number.isFinite(n) ? n : 0;
};

/** Doanh thu của một dòng hàng: đơn thật chỉ lưu đơn giá (retail_price) và số lượng, không có subtotal. */
export function lineRevenue(it: any): number {
    const sub = num(it?.subtotal);
    if (sub > 0) return sub;
    return num(it?.retail_price ?? it?.unit_price ?? it?.price) * num(it?.quantity);
}

/** Ý tưởng thuộc dịp nào nằm trong ID: `<loại>_<dịp>_<băm>` (dịp đã thay "/" bằng "-"). */
export function ideaBelongsToCamp(ideaId: string, campId: string): boolean {
    const camp = String(campId || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    return new RegExp(`^[a-z]+_${camp.replace(/[-]/g, '\-')}_`).test(String(ideaId || ''));
}

/**
 * AI-Analysic đo "đóng góp từ ý tưởng" bằng cách khớp tên sản phẩm với từ khóa gợi ý, nên sản phẩm đã gắn ý tưởng
 * nhưng đặt tên khác vẫn bị tính 0 đơn. Khi đã có số đo thật theo source_idea_id thì dùng số đó cho thẻ
 * thành quả và câu chuyện, để khớp với khung "Đơn từ sản phẩm của ý tưởng".
 */
export function applyIdeaOutcomesToImpact(impact: any, story: any, report: IdeaOutcomeReport): void {
    if (!impact || impact.status !== 'measured') return;
    const { orders, revenue, share_of_shop_orders_pct: share } = report.totals;
    impact.adopted_orders = orders;
    impact.adopted_gmv = revenue;
    impact.adopted_share_pct = share ?? 0;
    impact.adopted_basis = 'source_idea_id';
    const bullets: unknown = story?.results?.bullets;
    if (Array.isArray(bullets)) {
        const i = bullets.findIndex(b => typeof b === 'string' && b.startsWith('Đơn từ ý tưởng đã gợi ý'));
        const line = `Đơn từ sản phẩm của ý tưởng: ${orders} (${share ?? 0}% đơn của shop trong kỳ)`;
        if (i >= 0) bullets[i] = line;
    }
}

export function ideaOutcomes(input: {
    campId: string;
    savedIdeaIds: string[];
    snapshots: Record<string, { title?: string; kind?: string } | undefined>;
    drafts: Record<string, { title?: string } | undefined>;
    products: Array<{ _id: any; title?: string; source_idea_id?: string | null }>;
    orders: any[];
    window: { start: Date; end: Date };
}): IdeaOutcomeReport {
    const saved = new Set(input.savedIdeaIds);
    const productsByIdea = new Map<string, Array<{ id: string; title: string }>>();
    for (const p of input.products) {
        const ideaId = p.source_idea_id ? String(p.source_idea_id) : '';
        if (!ideaId || (!saved.has(ideaId) && !ideaBelongsToCamp(ideaId, input.campId))) continue;
        const list = productsByIdea.get(ideaId) || [];
        list.push({ id: String(p._id), title: p.title || '' });
        productsByIdea.set(ideaId, list);
    }
    const ideaOfProduct = new Map<string, string>();
    for (const [ideaId, list] of productsByIdea) for (const p of list) ideaOfProduct.set(p.id, ideaId);

    const { start, end } = input.window;
    const inWindow = input.orders.filter(o => {
        const t = new Date(o.created_at).getTime();
        return isValidDemandOrder(o) && t >= start.getTime() && t <= end.getTime();
    });

    const stats = new Map<string, { orders: Set<string>; units: number; revenue: number }>();
    const ideaOrders = new Set<string>();
    for (const o of inWindow) {
        for (const it of o.items || []) {
            const ideaId = ideaOfProduct.get(String(it.product_id));
            if (!ideaId) continue;
            const st = stats.get(ideaId) || { orders: new Set<string>(), units: 0, revenue: 0 };
            st.orders.add(String(o._id));
            st.units += num(it.quantity);
            st.revenue += lineRevenue(it);
            stats.set(ideaId, st);
            ideaOrders.add(String(o._id));
        }
    }

    const ids = [...input.savedIdeaIds, ...[...productsByIdea.keys()].filter(id => !saved.has(id))];
    const items: IdeaOutcome[] = ids.map(id => {
        const prods = productsByIdea.get(id) || [];
        const st = stats.get(id);
        const orders = st ? st.orders.size : 0;
        return {
            idea_id: id,
            title: input.snapshots[id]?.title || input.drafts[id]?.title || prods[0]?.title || id,
            kind: input.snapshots[id]?.kind || null,
            saved: saved.has(id),
            stage: orders > 0 ? 'selling' : prods.length > 0 ? 'listed' : 'idea',
            products: prods,
            orders,
            units: st ? st.units : 0,
            revenue: st ? Math.round(st.revenue) : 0,
        };
    });

    const revenue = items.reduce((s, i) => s + i.revenue, 0);
    return {
        items,
        totals: {
            ideas_saved: saved.size,
            ideas_listed: items.filter(i => i.stage !== 'idea').length,
            ideas_selling: items.filter(i => i.stage === 'selling').length,
            orders: ideaOrders.size,
            units: items.reduce((s, i) => s + i.units, 0),
            revenue,
            shop_orders_in_window: inWindow.length,
            share_of_shop_orders_pct: inWindow.length ? Math.round((100 * ideaOrders.size) / inWindow.length) : null,
        },
        window: { start: start.toISOString(), end: end.toISOString() },
    };
}
