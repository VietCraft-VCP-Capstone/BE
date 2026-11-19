export const CONTENT_FIELDS = ['title', 'tags', 'n_images', 'desc_words', 'has_size', 'materials', 'price'] as const;
export const PRELIM_DAYS = 7;
export const FULL_DAYS = 14;

export type ImpactStatus = 'collecting' | 'preliminary' | 'complete';
export type Snapshot = Partial<Record<(typeof CONTENT_FIELDS)[number], unknown>>;
export interface DaySnapshot { date: string; snapshot: Snapshot }
export interface Revision { date: string; changed: string[]; price_changed: boolean }
export interface DayCounts { views: number; carts: number }
export type DailySeries = Record<string, DayCounts>;

export interface ImpactNumbers {
    views_per_day: { pre: number; post: number; control_pre: number; control_post: number; did: number } | null;
    cart_rate: { pre: number | null; post: number | null; post_ci: [number, number] | null };
}

const canon = (v: unknown) => JSON.stringify(Array.isArray(v) ? [...v].map(String).sort() : (v ?? null));
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const ratio = (a: number, b: number) => (b > 0 ? round(a / b, 4) : null);
export const within = (date: string, from: string, to: string) => date >= from && date < to;

export function addDays(date: string, n: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function detectRevisions(series: DaySnapshot[]): Revision[] {
    const out: Revision[] = [];
    for (let i = 1; i < series.length; i++) {
        const prev = series[i - 1].snapshot;
        const cur = series[i].snapshot;
        const changed = CONTENT_FIELDS.filter(k => canon(prev[k]) !== canon(cur[k]));
        if (changed.length) out.push({ date: series[i].date, changed, price_changed: changed.includes('price') });
    }
    return out;
}

export function impactStatus(elapsed: number): { status: ImpactStatus; window: number | null } {
    if (elapsed < PRELIM_DAYS) return { status: 'collecting', window: null };
    if (elapsed < FULL_DAYS) return { status: 'preliminary', window: PRELIM_DAYS };
    return { status: 'complete', window: FULL_DAYS };
}

export function mixedChanges(revisions: Revision[], from: string, to: string): boolean {
    const inWindow = revisions.filter(r => within(r.date, from, to));
    return inWindow.length > 1 || inWindow.some(r => r.price_changed);
}

export function isStableControl(series: DaySnapshot[], from: string, to: string): boolean {
    return series.some(s => within(s.date, from, to)) && !detectRevisions(series).some(r => within(r.date, from, to));
}

export function windowSum(series: DailySeries, from: string, days: number): DayCounts {
    const out = { views: 0, carts: 0 };
    for (let i = 0; i < days; i++) {
        const day = series[addDays(from, i)];
        if (day) {
            out.views += day.views;
            out.carts += day.carts;
        }
    }
    return out;
}

export function didEffect(treated: { pre: number; post: number }, control: { pre: number; post: number }): number {
    return (treated.post - treated.pre) - (control.post - control.pre);
}

export function wilsonInterval(successes: number, n: number, z = 1.96): [number, number] | null {
    if (n <= 0) return null;
    const p = successes / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denom;
    const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
    return [round(Math.max(0, center - half), 4), round(Math.min(1, center + half), 4)];
}

export function impactNumbers(treated: DailySeries, controls: DailySeries[], date: string, days: number): ImpactNumbers {
    const from = addDays(date, -days);
    const tPre = windowSum(treated, from, days);
    const tPost = windowSum(treated, date, days);
    const cPre = controls.map(c => windowSum(c, from, days).views / days);
    const cPost = controls.map(c => windowSum(c, date, days).views / days);
    const pre = tPre.views / days;
    const post = tPost.views / days;
    return {
        views_per_day: controls.length === 0 ? null : {
            pre: round(pre, 2),
            post: round(post, 2),
            control_pre: round(avg(cPre), 2),
            control_post: round(avg(cPost), 2),
            did: round(didEffect({ pre, post }, { pre: avg(cPre), post: avg(cPost) }), 2),
        },
        cart_rate: {
            pre: ratio(tPre.carts, tPre.views),
            post: ratio(tPost.carts, tPost.views),
            post_ci: wilsonInterval(Math.min(tPost.carts, tPost.views), tPost.views),
        },
    };
}
