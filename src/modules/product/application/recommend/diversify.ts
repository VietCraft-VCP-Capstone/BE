export const POPULAR_REASON = 'Đang được quan tâm';

const MAX_PER_SHOP = 2;
const EXPLORE_MIN_LIMIT = 6;

export interface Diversifiable {
    id: string;
    shopId: string;
    categories: string[];
}

export interface ReasonPart {
    value: number;
    label: string;
}

/** Nhãn của thành phần đóng góp nhiều điểm nhất; không có thành phần nào thì dùng nhãn phổ biến. */
export function pickReason(parts: ReasonPart[]): string {
    const best = parts
        .filter(p => p.value > 0 && p.label)
        .sort((a, b) => b.value - a.value)[0];
    return best ? best.label : POPULAR_REASON;
}

/** Giới hạn 2 sản phẩm mỗi shop, 50% slot mỗi danh mục (mềm), và chừa 1 slot khám phá khi limit ≥ 6. */
export function diversify<T extends Diversifiable>(ranked: T[], limit: number, explore?: T): T[] {
    const reserve = explore && limit >= EXPLORE_MIN_LIMIT ? 1 : 0;
    const slots = limit - reserve;
    const catCap = Math.max(1, Math.floor(limit / 2));
    const shopCount = new Map<string, number>(reserve && explore ? [[explore.shopId, 1]] : []);
    const catCount = new Map<string, number>();
    const used = new Set<string>(reserve && explore ? [explore.id] : []);
    const out: T[] = [];

    const take = (c: T) => {
        const primary = c.categories[0] ?? '';
        out.push(c);
        used.add(c.id);
        shopCount.set(c.shopId, (shopCount.get(c.shopId) ?? 0) + 1);
        catCount.set(primary, (catCount.get(primary) ?? 0) + 1);
    };
    const shopFull = (c: T) => (shopCount.get(c.shopId) ?? 0) >= MAX_PER_SHOP;
    const catFull = (c: T) => (catCount.get(c.categories[0] ?? '') ?? 0) >= catCap;

    for (const c of ranked) {
        if (out.length >= slots) break;
        if (!used.has(c.id) && !shopFull(c) && !catFull(c)) take(c);
    }
    for (const c of ranked) {
        if (out.length >= slots) break;
        if (!used.has(c.id) && !shopFull(c)) take(c);
    }
    for (const c of ranked) {
        if (out.length >= slots) break;
        if (!used.has(c.id)) take(c);
    }
    if (reserve && explore) out.push(explore);
    return out;
}
