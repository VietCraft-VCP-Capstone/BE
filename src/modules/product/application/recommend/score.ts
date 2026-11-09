import { accentInsensitive } from '../../../../shared/utils/vietnamese-search.util';
import { Diversifiable, POPULAR_REASON, pickReason } from './diversify';
import { Profile } from './user-profile';

export interface Candidate extends Diversifiable {
    title: string;
    tags: string[];
    price: number;
    health: number | null;
    rating: number;
    tierBoost: number;
    sold: number;
    pop: number;
    doc: any;
}

export interface Scored extends Candidate {
    score: number;
    reason: string;
}

export interface TasteCtx {
    profile: Profile;
    keywords: string[];
    followed: Set<string>;
}

const DEFAULT_HEALTH = 0.7;

function healthPart(c: Candidate): number {
    return c.health == null ? DEFAULT_HEALTH : c.health / 100;
}

/** Phần chất lượng, 1 đến 3 điểm, dùng để xếp giữa các sản phẩm cùng gu. */
function quality(c: Candidate): number {
    return healthPart(c) + 0.2 * Math.log(c.sold + 1) + 0.3 * c.rating + c.tierBoost;
}

function nearPrice(price: number, ref: number): boolean {
    return ref > 0 && Math.abs(price - ref) <= 0.35 * ref;
}

function matchesKeyword(c: Candidate, keyword: string): boolean {
    if (!keyword) return false;
    const re = new RegExp(accentInsensitive(keyword), 'i');
    return re.test(c.title) || c.tags.some(t => re.test(t)) || c.categories.some((x: string) => re.test(x));
}

function bestCategory(c: Candidate, catW: Map<string, number>): string {
    const cats = c.categories;
    return cats.reduce((best: string, x: string) => ((catW.get(x) ?? 0) > (catW.get(best) ?? 0) ? x : best), cats[0] ?? '');
}

export function scoreForYou(c: Candidate, ctx: TasteCtx): Scored {
    const { profile: p, keywords, followed } = ctx;
    const cats: string[] = c.categories;
    const cat = bestCategory(c, p.catW);
    const catPart = 3 * Math.max(0, ...cats.map(x => p.catW.get(x) ?? 0));
    const tagSum = [...new Set(c.tags)].reduce((s, t) => s + (p.tagW.get(t) ?? 0), 0);
    const tagPart = 2 * Math.min(1, tagSum);
    const kw = keywords.find(k => matchesKeyword(c, k));
    const kwPart = kw ? 2 : 0;
    const pricePart = nearPrice(c.price, p.priceRef) ? 0.5 : 0;
    const followPart = followed.has(c.shopId) ? 0.5 : 0;
    const score = catPart + tagPart + kwPart + pricePart + followPart + quality(c);
    const catLabel = cat ? `Vì bạn đã mua/xem ${cat}` : '';
    const reason = pickReason([
        { value: catPart, label: catLabel },
        { value: tagPart, label: catLabel },
        { value: kwPart, label: kw ? `Phù hợp tìm kiếm "${kw}"` : '' },
        { value: followPart, label: 'Từ shop bạn theo dõi' },
    ]);
    return { ...c, score, reason };
}

/** Cold start: độ phổ biến 30 ngày + health + tier. */
export function scorePopular(c: Candidate): Scored {
    const score = Math.log(1 + c.pop) + healthPart(c) + c.tierBoost;
    return { ...c, score, reason: POPULAR_REASON };
}

/** Slot khám phá: phổ biến nhất trong các danh mục khách chưa biết. */
export function pickExplore(list: Scored[], knownCats: Set<string>): Scored | undefined {
    const fresh = list
        .filter(c => !(c.categories).some((x: string) => knownCats.has(x)))
        .sort((a, b) => b.pop - a.pop)[0];
    return fresh && { ...fresh, reason: POPULAR_REASON };
}

export interface Anchor {
    categories: string[];
    tags: string[];
    price: number;
    shopId: string;
}

/** Sản phẩm liên quan: cùng danh mục +3, mỗi tag trùng +1.5 (tối đa 3), giá ±35% +1, shop khác +1. */
export function scoreRelated(c: Candidate, a: Anchor): Scored {
    const sharedCat = (c.categories).some((x: string) => a.categories.includes(x)) ? 3 : 0;
    const sharedTags = [...new Set(c.tags)].filter(t => a.tags.includes(t)).length;
    const score = sharedCat
        + 1.5 * Math.min(3, sharedTags)
        + (nearPrice(c.price, a.price) ? 1 : 0)
        + (c.shopId !== a.shopId ? 1 : 0)
        + quality(c);
    return { ...c, score, reason: '' };
}

export function byScore(a: Scored, b: Scored): number {
    return b.score - a.score;
}
