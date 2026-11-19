import { Types } from 'mongoose';
import { Product } from '../../product/infrastructure/models/product.model';
import { Category } from '../../category/infrastructure/models/category.model';
import { SearchLog } from '../infrastructure/models/search-log.model';
import { findSearchHits } from '../../product/application/atlas-search';
import { buildSearchPipeline, buildTermsMatch } from '../../product/application/product-search.pipeline';
import { nfcLower } from '../../../shared/utils/vietnamese-search.util';
import { buildMeta, ok, Envelope } from './envelope';
import { ListingHealthService } from './listing-health.service';
import {
    aboutProduct, actualRank, queryInsights, QueryInsight, QueryRow, zeroResultInsights, ZeroResultInsight,
} from './search-gap-match';

const DAYS = 30;
const MAX_PEERS = 2000;
const MAX_QUERIES = 8;
const MIN_SEARCHES = 2;
const TOP_RESULTS = 48;

export interface SearchInsightsData {
    days: number;
    category: string | null;
    queries: QueryInsight[];
    zero_result: ZeroResultInsight[];
}

type ErrorBody = { error: string; field?: string; resource?: string };

async function categoryName(name: string | undefined, id: Types.ObjectId | undefined): Promise<string | null> {
    if (name) return name;
    if (!id) return null;
    const category = await Category.findById(id).select('name').lean();
    return category?.name ?? null;
}

async function topQueries(since: Date, match: Record<string, unknown>, limit: number): Promise<QueryRow[]> {
    const rows = await SearchLog.aggregate<{ _id: string; searches: number }>([
        { $match: { created_at: { $gte: since }, ...match } },
        { $group: { _id: '$keyword', searches: { $sum: 1 } } },
        { $match: { searches: { $gte: MIN_SEARCHES } } },
        { $sort: { searches: -1 } },
        { $limit: limit },
    ]);
    return rows.map(r => ({ query: r._id, searches: r.searches }));
}

async function searchRank(keyword: string, productId: string): Promise<number | null> {
    const q = nfcLower(keyword).slice(0, 100);
    const terms = [...new Set(q.split(/\s+/).filter(Boolean))].slice(0, 8);
    if (!terms.length) return null;
    const hits = await findSearchHits(q);
    const [res] = await Product.aggregate([
        ...buildSearchPipeline({
            match: {
                status: 'PUBLISHED', is_hidden: { $ne: true }, listing_status: 'ACTIVE', moderation_status: 'APPROVED',
                $and: hits ? [{ _id: { $in: hits.ids } }] : buildTermsMatch(terms),
            },
            q, priceStock: {}, sort: { _relevance: -1, created_at: -1 }, withSold: false,
            page: 1, limit: TOP_RESULTS, searchHits: hits ?? undefined,
        }),
        { $project: { ids: '$items._id' } },
    ], { allowDiskUse: true });
    return actualRank((res?.ids ?? []).map(String), productId);
}

export async function searchInsights(productId: string, shopId: string): Promise<{ httpStatus: number; body: Envelope<SearchInsightsData> | ErrorBody }> {
    if (!ListingHealthService.isValidObjectId(productId)) return { httpStatus: 400, body: { error: 'invalid_param', field: 'id' } };
    const owned = await ListingHealthService.ownedProduct(productId, shopId);
    if ('denied' in owned) return owned.denied;
    const { product } = owned;

    const meta = (n: number) => buildMeta({ scope: 'listing', scope_id: productId, database: 'vietcraft', collection: 'search_logs', mode: 'live', attributed_to_live_shop: true, sample_size: n });
    const category = await categoryName(product.categories?.[0], product.category_ids?.[0]);
    const title = product.title ?? '';
    const tags = product.tags ?? [];
    if (!category) return { httpStatus: 200, body: ok({ days: DAYS, category, queries: [], zero_result: [] }, meta(0)) };

    const since = new Date(Date.now() - DAYS * 86_400_000);
    const peers = await Product.find({ categories: category, seed_ref: { $exists: false } }).select('_id').limit(MAX_PEERS).lean();
    const [clicked, zero] = await Promise.all([
        topQueries(since, { 'clicks.product_id': { $in: peers.map(p => p._id) } }, 50),
        topQueries(since, { result_count: 0 }, 50),
    ]);
    const relevant = clicked.filter(r => aboutProduct(r.query, category, title, tags)).slice(0, MAX_QUERIES);
    const ranks = await Promise.all(relevant.map(r => searchRank(r.query, productId)));
    const queries = queryInsights(relevant.map((r, i) => ({ ...r, actual_rank: ranks[i] })), title, tags);
    const zero_result = zeroResultInsights(zero, category, title, tags);
    return { httpStatus: 200, body: ok({ days: DAYS, category, queries, zero_result }, meta(relevant.length)) };
}
