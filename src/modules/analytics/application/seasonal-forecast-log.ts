// Nhật ký dự báo mùa vụ: mỗi tuần lưu một bản "nếu bán như ngày thường" cho kỳ dịp,
// sau lễ so với số đơn thực tế để seller thấy độ chính xác thật của hệ thống.

export interface Interval { p10: number; p50: number; p90: number }

/** Phân vị Poisson nhỏ nhất k có CDF(k) ≥ q (λ lớn dùng xấp xỉ chuẩn). */
function poissonPpf(q: number, lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 500) {
        const z = q < 0.5 ? -1.2815515655446004 : 1.2815515655446004;
        return Math.max(0, Math.round(lambda + z * Math.sqrt(lambda)));
    }
    let logPmf = -lambda;
    let cdf = Math.exp(logPmf);
    let k = 0;
    while (cdf < q && k < 10_000) {
        k += 1;
        logPmf += Math.log(lambda) - Math.log(k);
        cdf += Math.exp(logPmf);
    }
    return k;
}

/** Khoảng 80% của số đơn khi kỳ vọng là λ (khớp `normal_day_orders` phía AI). */
export function poissonInterval(lambda: number): Interval {
    const lam = Math.max(0, Number(lambda) || 0);
    return { p10: poissonPpf(0.1, lam), p50: Math.round(lam * 10) / 10, p90: poissonPpf(0.9, lam) };
}

/** Mã tuần ISO theo giờ Việt Nam, vd. 2026-W49. */
export function isoWeekKeyVn(at: Date): string {
    const vn = new Date(at.getTime() + 7 * 3600_000);
    const d = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
    const dow = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dow); // thứ Năm cùng tuần quyết định năm ISO
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface ForecastLogLike { days_to_event: number; expected: Interval; made_at?: string | Date }

export interface ForecastAccuracy {
    n: number;
    hits: number;
    coverage_pct: number;
    actual: number;
    items: Array<{ days_to_event: number; expected: Interval; verdict: 'below' | 'within' | 'above' }>;
}

/** So từng bản dự báo đã lưu với số đơn thực tế của kỳ; null nếu chưa có bản nào. */
export function forecastAccuracy(logs: ForecastLogLike[], actual: number): ForecastAccuracy | null {
    if (!logs.length) return null;
    const items = [...logs]
        .sort((a, b) => b.days_to_event - a.days_to_event)
        .map(l => ({
            days_to_event: l.days_to_event,
            expected: l.expected,
            verdict: (actual < l.expected.p10 ? 'below' : actual > l.expected.p90 ? 'above' : 'within') as 'below' | 'within' | 'above',
        }));
    const hits = items.filter(i => i.verdict === 'within').length;
    return { n: items.length, hits, coverage_pct: Math.round((100 * hits) / items.length), actual, items };
}
