export const WEIGHTS = { purchase: 5, cart: 3, wishlist: 3, click: 2, view: 1 };
export const VIEW_CAP = 3;
export const WINDOW_DAYS = 90;
export const HALF_LIFE_DAYS = 14;
export const PROFILE_SIZE = 50;

const DAY_MS = 86400000;

/** w × 0.5^(ngày / 14); quá 90 ngày thì bằng 0. */
export function decayWeight(w: number, at: Date | undefined, now = Date.now()): number {
    if (!at) return 0;
    const days = Math.max(0, (now - new Date(at).getTime()) / DAY_MS);
    if (days > WINDOW_DAYS) return 0;
    return w * Math.pow(0.5, days / HALF_LIFE_DAYS);
}

export interface ProfileInput {
    weight: number;
    categories: string[];
    tags: string[];
    price: number;
}

export interface Profile {
    catW: Map<string, number>;
    tagW: Map<string, number>;
    priceRef: number;
    topCategories: string[];
    topTags: string[];
}

function normalize(m: Map<string, number>): void {
    const max = Math.max(0, ...m.values());
    if (max > 0) for (const [k, v] of m) m.set(k, v / max);
}

function topKeys(m: Map<string, number>, n: number): string[] {
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

function median(sorted: number[]): number {
    if (sorted.length === 0) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Hồ sơ gu: danh mục và tag chuẩn hoá 0..1, giá trung vị của các sản phẩm đã tương tác. */
export function computeProfile(inputs: ProfileInput[]): Profile {
    const top = [...inputs].sort((a, b) => b.weight - a.weight).slice(0, PROFILE_SIZE);
    const catW = new Map<string, number>();
    const tagW = new Map<string, number>();
    for (const it of top) {
        for (const c of new Set(it.categories)) catW.set(c, (catW.get(c) ?? 0) + it.weight);
        for (const t of new Set(it.tags)) tagW.set(t, (tagW.get(t) ?? 0) + it.weight);
    }
    normalize(catW);
    normalize(tagW);
    const prices = top.map(i => i.price).filter(p => p > 0).sort((a, b) => a - b);
    return {
        catW,
        tagW,
        priceRef: median(prices),
        topCategories: topKeys(catW, 5),
        topTags: topKeys(tagW, 10),
    };
}
