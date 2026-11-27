// Các phép tính số liệu mùa vụ dùng chung, tách khỏi service để kiểm thử được.
// Nguyên tắc: thiếu dữ liệu thì trả null, không thay bằng hằng số.

export const RATE_WINDOW_DAYS = 60;
export const MIN_ORDERS_FOR_RATE = 5;

const toNum = (v: unknown): number => {
    const n = parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : 0;
};

/** Đơn thể hiện cầu thật: không hủy, không hoàn tiền, không giả lập, PayOS phải đã trả tiền. */
export function isValidDemandOrder(o: any): boolean {
    if (!o || o.is_simulated === true) return false;
    if (o.order_status === 'CANCELLED') return false;
    if (o.refund_status === 'REFUNDED' || o.payment_status === 'REFUNDED') return false;
    if (o.payment_method === 'PAYOS' && o.payment_status !== 'PAID') return false;
    return true;
}

/** Giá trị hàng của đơn (subtotal). */
export function orderGmv(o: any): number {
    return toNum(o?.financial_breakdown?.subtotal);
}

export const MIN_BASELINE_COVERAGE_DAYS = 14;
const DAY_MS = 86400000;

const createdMs = (o: any): number => new Date(o?.created_at).getTime();

export interface BaselineRate {
    rate: number | null;
    orders: number;
    coverage_days: number;
    /** baseline_history: shop chưa đủ ngày có đơn trước mùa; baseline_orders: đủ ngày nhưng quá ít đơn */
    missing: 'baseline_history' | 'baseline_orders' | null;
}

/**
 * Nhịp đơn hợp lệ mỗi ngày TRƯỚC kỳ dịp (tối đa `days` ngày trước `windowStart`).
 * Không dùng đơn trong kỳ dịp để mục tiêu không bị suy ra từ chính kết quả đem so.
 * Shop mới: chia theo số ngày kể từ đơn hợp lệ đầu tiên thay vì đủ `days`.
 */
export function baselineDailyRate(orders: any[], windowStart: Date, days = RATE_WINDOW_DAYS): BaselineRate {
    const endMs = windowStart.getTime();
    const valid = orders.filter(o => isValidDemandOrder(o) && Number.isFinite(createdMs(o)));
    const firstMs = valid.reduce((m, o) => Math.min(m, createdMs(o)), Infinity);
    const startMs = Math.max(endMs - days * DAY_MS, firstMs);
    const coverageDays = Number.isFinite(startMs) ? Math.max(0, Math.ceil((endMs - startMs) / DAY_MS)) : 0;
    const n = valid.filter(o => createdMs(o) >= startMs && createdMs(o) < endMs).length;
    if (coverageDays < MIN_BASELINE_COVERAGE_DAYS) return { rate: null, orders: n, coverage_days: coverageDays, missing: 'baseline_history' };
    if (n < MIN_ORDERS_FOR_RATE) return { rate: null, orders: n, coverage_days: coverageDays, missing: 'baseline_orders' };
    return { rate: n / coverageDays, orders: n, coverage_days: coverageDays, missing: null };
}

/** Đơn hợp lệ đặt trong [start, end]. */
export function ordersInWindow(orders: any[], start: Date, end: Date): any[] {
    const a = start.getTime();
    const b = end.getTime();
    return orders.filter(o => isValidDemandOrder(o) && createdMs(o) >= a && createdMs(o) <= b);
}

export interface OrderStatusBreakdown {
    delivered: number;
    shipping: number;
    processing: number;
    /** đơn COD chưa thu tiền (có thể còn bị boom/hoàn) */
    cod_unpaid: number;
}

export function orderStatusBreakdown(orders: any[]): OrderStatusBreakdown {
    const out: OrderStatusBreakdown = { delivered: 0, shipping: 0, processing: 0, cod_unpaid: 0 };
    for (const o of orders) {
        if (o.order_status === 'DELIVERED') out.delivered += 1;
        else if (o.order_status === 'SHIPPING') out.shipping += 1;
        else out.processing += 1;
        if (o.payment_method === 'COD' && o.payment_status !== 'PAID') out.cod_unpaid += 1;
    }
    return out;
}

export interface MeasuredUplift {
    value: number;
    source: 'deep_model' | 'search_interest';
}

/** Độ nâng cầu của dịp do AI đo được (P50). Không có số đo thì null. */
export function measuredUplift(info: any): MeasuredUplift | null {
    const v = Number(info?.uplift_p50);
    if (!Number.isFinite(v) || v <= 0) return null;
    return { value: v, source: info?.validated_deep_model ? 'deep_model' : 'search_interest' };
}

/** Mục tiêu đơn của dịp; null khi thiếu nhịp đơn hoặc độ nâng. */
export function targetOrders(ratePerDay: number | null, windowDays: number, uplift: number | null): number | null {
    if (ratePerDay == null || uplift == null) return null;
    return Math.max(1, Math.round(ratePerDay * windowDays * uplift));
}

/** 00:00 giờ Việt Nam của ngày `YYYY-MM-DD`. */
export function vnDayStart(isoDate: string): Date {
    return new Date(`${isoDate}T00:00:00+07:00`);
}

/** 23:59:59.999 giờ Việt Nam của ngày `YYYY-MM-DD`. */
export function vnDayEnd(isoDate: string): Date {
    return new Date(`${isoDate}T23:59:59.999+07:00`);
}

export const DEFAULT_COMMISSION_RATE = 0.10;

/** Phí sàn từ tài liệu `platform_cost_configs`; giá trị ngoài (0, 1) coi như chưa cấu hình. */
export function parseCommissionRate(cfg: any): number {
    const r = Number(cfg?.policies?.default_commission_rate);
    return Number.isFinite(r) && r > 0 && r < 1 ? r : DEFAULT_COMMISSION_RATE;
}

/** % lãi sau giá vốn và phí sàn. */
export function netMarginPct(price: number, cost: number, commissionRate: number): number {
    return Math.round(((price - cost - price * commissionRate) / Math.max(1, price)) * 100);
}

/** Tên các dịp có kỳ bán (traction_start → peak_date) giao với [start, end), bỏ qua dịp `excludeId`. */
export function overlappingCampaigns(campaigns: any[], start: Date, end: Date, excludeId?: string): string[] {
    const a = start.getTime();
    const b = end.getTime();
    return (campaigns || [])
        .filter(c => c?.id !== excludeId)
        .filter(c => {
            const s = c?.launch_window?.traction_start;
            const e = c?.launch_window?.peak_date;
            if (!s || !e) return false;
            return vnDayStart(String(s).slice(0, 10)).getTime() < b && vnDayEnd(String(e).slice(0, 10)).getTime() >= a;
        })
        .map(c => String(c.name || c.id));
}

const ddmm = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const dayDiff = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/** Căn cứ của mốc thời gian trong gợi ý hành động, theo đúng lead time/số ngày chuẩn bị của dịp. */
export function campaignTimingBasis(camp: any, actionType: 'close_orders' | 'boost_traffic' | 'prepare_inventory'): string {
    const lw = camp?.launch_window || {};
    const cut = String(lw.end || '').slice(0, 10);
    const ev = String(lw.peak_date || '').slice(0, 10);
    const trac = String(lw.traction_start || '').slice(0, 10);
    const rd = String(lw.start || '').slice(0, 10);
    if (!cut || !ev) return '';
    if (actionType === 'close_orders') {
        return `Hạn chốt ${ddmm(cut)} = Ngày lễ (${ddmm(ev)}) − ${Number(camp?.lead_time_days) || dayDiff(cut, ev)} ngày (thời gian làm hàng và giao hàng).`;
    }
    if (actionType === 'boost_traffic' && trac) {
        return `Bắt đầu mở bán ${ddmm(trac)}, trước hạn chốt đơn (${ddmm(cut)}) ${dayDiff(trac, cut)} ngày để sàn kịp index từ khóa và gom đánh giá.`;
    }
    if (rd) {
        return `Bắt đầu chuẩn bị ${ddmm(rd)} = Hạn chốt đơn (${ddmm(cut)}) − ${Number(camp?.prep_days) || dayDiff(rd, cut)} ngày chuẩn bị của dịp.`;
    }
    return '';
}
