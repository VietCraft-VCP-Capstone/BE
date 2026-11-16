import { Product as MongoProduct } from '../../infrastructure/models/product.model';
import { ProductsService, PUBLIC_QUERY } from '../product.service';
import { ProductItemResponseDTO } from '../product.dto';
import { getSoldCounts } from '../product-sold';
import { cacheService } from '../../../../shared/services/cache.service';
import { staleFirst, warmPopular } from './for-you-cache';
import { loadSignals } from './user-signals';
import { signalVersion } from './signal-version';
import { loadProfileInputs, minPriceOf } from './signal-products';
import { computeProfile, Profile } from './user-profile';
import { fetchCandidates, tasteClauses } from './recommend.pipeline';
import { popularity } from './popular';
import { diversify, POPULAR_REASON } from './diversify';
import {
    Candidate, Scored, byScore, pickExplore, scoreForYou, scorePopular, scoreRelated,
} from './score';

export interface ForYouParams {
    userId?: string;
    sessionId?: string;
    limit: number;
    q: string[];
}

export type ForYouItem = { id: string; title: string; images: string[]; price: number; category: string; reason: string };

const POOL_SIZE = 200;
const FOR_YOU_TTL = 300;
const EXPLORE_MIN_LIMIT = 6;
const TASTE_SLICE = 100;
const EXTRA = 4; // dư vài sp để lọc giỏ/đơn mới mà vẫn đủ limit

const baseMatch = () => ({
    ...PUBLIC_QUERY,
    listing_status: 'ACTIVE',
    moderation_status: 'APPROVED',
});

function uniqueDocs(...lists: any[][]): any[] {
    const seen = new Map<string, any>();
    for (const d of lists.flat()) if (!seen.has(String(d._id))) seen.set(String(d._id), d);
    return [...seen.values()];
}

function toCandidate(doc: any, sold: Map<string, number>, pop?: Map<string, number>): Candidate {
    const id = String(doc._id);
    return {
        id,
        shopId: String(doc.shop_id),
        categories: doc.categories ?? [],
        tags: doc.tags ?? [],
        title: doc.title ?? '',
        price: doc._minPrice ?? 0,
        health: doc._health ?? null,
        rating: doc._rating ?? 0,
        tierBoost: doc._tierBoost ?? 0,
        sold: sold.get(id) ?? 0,
        pop: pop?.get(id) ?? 0,
        doc,
    };
}

function clampLimit(n: number): number {
    return Math.min(24, Math.max(1, Math.floor(n) || 8));
}

// Một danh sách dự phòng 24 sp dùng chung cho mọi limit
const POPULAR_KEY = 'vietcraft:foryou3:popular';
const popularAll = () => computeForYou({ limit: 24, q: [] });

export class RecommendService {

    static async forYou(p: ForYouParams): Promise<ForYouItem[]> {
        const { version, hide } = await signalVersion(p.userId, p.sessionId);
        const owner = p.userId || (version === '0-0-0' || version === '0' ? 'anon' : p.sessionId) || 'anon';
        const tail = `${p.limit}:${cacheService.hashKey(p.q)}`;
        const key = `vietcraft:foryou3:${owner}:${version}:${tail}`;
        const lastKey = `vietcraft:foryou3:last:${owner}:${tail}`;
        const list = await staleFirst(key, lastKey, POPULAR_KEY, FOR_YOU_TTL, () => computeForYou({ ...p, limit: p.limit + EXTRA }), popularAll);
        return list.filter(i => !hide.has(i.id)).slice(0, p.limit);
    }

    static warmPopular(): Promise<void> {
        return warmPopular(POPULAR_KEY, popularAll);
    }

    static async related(id: string, category: string | undefined, limit: number): Promise<ProductItemResponseDTO[]> {
        const self = await MongoProduct.findById(id).select('categories tags shop_id').lean();
        if (!self) return [];
        const n = clampLimit(limit);
        const cats = category ? [category] : (self.categories ?? []);
        const tags = self.tags ?? [];
        const price = (await minPriceOf([self._id])).get(String(self._id)) ?? 0;

        const base = { ...baseMatch(), _id: { $ne: self._id } };
        const ors = [
            ...(cats.length ? [{ categories: { $in: cats } }] : []),
            ...(tags.length ? [{ tags: { $in: tags } }] : []),
        ];
        let docs = ors.length ? await fetchCandidates({ ...base, $or: ors }) : [];
        if (docs.length < n) docs = uniqueDocs(docs, await fetchCandidates(base));

        const sold = await getSoldCounts(docs.map(d => d._id));
        const anchor = { categories: cats, tags, price, shopId: String(self.shop_id) };
        const ranked = docs.map(d => scoreRelated(toCandidate(d, sold), anchor)).sort(byScore);
        return ProductsService.mapMany(diversify(ranked, n).map(c => c.doc), sold);
    }
}

async function computeForYou(p: ForYouParams): Promise<ForYouItem[]> {
    const limit = clampLimit(p.limit);
    const [sig, { topIds, pop }] = await Promise.all([
        loadSignals({ userId: p.userId, sessionId: p.sessionId, q: p.q }),
        popularity(POOL_SIZE),
    ]);
    const profile: Profile = computeProfile(await loadProfileInputs(sig.items));

    const base = {
        ...baseMatch(),
        _id: { $nin: sig.excluded },
        shop_id: { $nin: sig.ownShopIds },
    };
    const clauses = tasteClauses(profile, sig.keywords, sig.followedShopIds);

    // Hàng mới nhất bù slot khi metric phổ biến chưa đủ sản phẩm
    const taste = { ...base, $or: clauses };
    const [tasteParts, topDocs, newestDocs] = await Promise.all([
        clauses.length ? Promise.all([
            fetchCandidates(taste, TASTE_SLICE),
            fetchCandidates(taste, TASTE_SLICE, { rating_count: -1, average_rating: -1 }),
            topIds.length ? fetchCandidates({ ...taste, _id: { $in: topIds, $nin: sig.excluded } }) : Promise.resolve([]),
        ]) : Promise.resolve([]),
        topIds.length ? fetchCandidates({ ...base, _id: { $in: topIds, $nin: sig.excluded } }) : Promise.resolve([]),
        fetchCandidates(base, POOL_SIZE),
    ]);
    const tasteDocs = uniqueDocs(...tasteParts);
    const popDocs = uniqueDocs(topDocs, newestDocs);
    const all = uniqueDocs(tasteDocs, popDocs);
    const ids = all.map(d => d._id);
    const sold = await getSoldCounts(ids);
    const toC = (d: any) => toCandidate(d, sold, pop);

    const ctx = { profile, keywords: sig.keywords, followed: new Set(sig.followedShopIds) };
    const tasteIds = new Set(tasteDocs.map(d => String(d._id)));
    const tasteRanked = tasteDocs.map(d => scoreForYou(toC(d), ctx)).sort(byScore);
    const popRanked = popDocs
        .filter(d => !tasteIds.has(String(d._id)))
        .map(d => scorePopular(toC(d)))
        .sort(byScore);

    const known = new Set(profile.catW.keys());
    const explore: Scored | undefined = limit >= EXPLORE_MIN_LIMIT
        ? pickExplore([...tasteRanked, ...popRanked], known)
        : undefined;

    const picked = diversify([...tasteRanked, ...popRanked], limit, explore);
    const dtos = await ProductsService.mapMany(picked.map(c => c.doc), sold);
    return dtos.map((d, i) => ({ id: d.id, title: d.title, images: (d.images ?? []).slice(0, 1), price: d.price, category: d.category, reason: picked[i].reason || POPULAR_REASON }));
}
