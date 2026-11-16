import { Types } from 'mongoose';
import { Product as MongoProduct } from '../infrastructure/models/product.model';
import { normalizeVi } from '../../../shared/utils/vietnamese-search.util';
import { logger } from '../../../shared/utils/logger';

export const SEARCH_INDEX = 'products_search';

export const SEARCH_INDEX_DEFINITION = {
    mappings: { dynamic: false, fields: {
        title: { type: 'string', analyzer: 'viFold', multi: { compact: { type: 'string', analyzer: 'viCompact' } } },
        tags: { type: 'string', analyzer: 'viFold', multi: { compact: { type: 'string', analyzer: 'viCompact' } } },
        categories: { type: 'string', analyzer: 'viFold' },
        description: { type: 'string', analyzer: 'viFold' },
    } },
    analyzers: [
        { name: 'viFold', tokenizer: { type: 'standard' }, tokenFilters: [{ type: 'lowercase' }, { type: 'icuFolding' }] },
        { name: 'viCompact', charFilters: [{ type: 'mapping', mappings: { ' ': '' } }], tokenizer: { type: 'nGram', minGram: 3, maxGram: 5 }, tokenFilters: [{ type: 'lowercase' }, { type: 'icuFolding' }] },
    ],
};

const PATHS = ['title', 'tags', 'categories'];
const CACHE_MS = 5 * 60 * 1000;
let readyCache: { value: boolean; at: number } | null = null;

export async function isAtlasSearchReady(): Promise<boolean> {
    if (readyCache && Date.now() - readyCache.at < CACHE_MS) return readyCache.value;
    let value = false;
    try {
        const indexes = await MongoProduct.collection.listSearchIndexes(SEARCH_INDEX).toArray();
        value = indexes.some((i: any) => i.queryable === true);
    } catch {
        value = false; // Mongo local không hỗ trợ Atlas Search
    }
    readyCache = { value, at: Date.now() };
    return value;
}

function strictQuery(q: string): object {
    const should: object[] = [{ text: { query: q, path: PATHS, matchCriteria: 'all' } }];
    // Chỉ dò kiểu gõ liền ("aothun"); có dấu cách thì ghép lại dễ khớp nhầm qua ranh giới từ ("thun nón")
    if (!/\s/.test(q) && q.length >= 3) {
        should.push({ text: { query: q, path: [{ value: 'title', multi: 'compact' }, { value: 'tags', multi: 'compact' }], matchCriteria: 'all' } });
    }
    return { compound: { should, minimumShouldMatch: 1 } };
}

function fuzzyQuery(q: string): object {
    const words = q.split(/\s+/).filter(Boolean).slice(0, 8);
    return {
        compound: {
            must: words.map(w => ({
                text: {
                    query: w,
                    path: PATHS,
                    ...(normalizeVi(w).length >= 5 ? { fuzzy: { maxEdits: 1, prefixLength: 1 } } : {}),
                },
            })),
        },
    };
}

async function runSearch(query: object): Promise<{ _id: Types.ObjectId; s: number }[]> {
    return MongoProduct.aggregate([
        { $search: { index: SEARCH_INDEX, ...query } },
        // shortcut: tối đa 500 kết quả, tăng/paginate bằng $search khi catalog lớn
        { $limit: 500 },
        { $project: { _id: 1, s: { $meta: 'searchScore' } } },
    ]);
}

export async function findSearchHits(q: string): Promise<{ ids: Types.ObjectId[]; scores: number[] } | null> {
    const query = q.trim();
    if (!query || !(await isAtlasSearchReady())) return null;
    try {
        let docs = await runSearch(strictQuery(query));
        if (docs.length === 0) docs = await runSearch(fuzzyQuery(query));
        // Gõ lặp phím ("aoo thun") ở từ ngắn không được fuzzy, thử gộp chữ lặp
        const squeezed = query.replace(/(\p{L})\1+/gu, '$1');
        if (docs.length === 0 && squeezed !== query && squeezed.replace(/\s/g, '').length >= 2) docs = await runSearch(fuzzyQuery(squeezed));
        // Lượt cuối: cụm từ liền nhau trong mô tả, rời rạc thì khớp nhầm ("mộc ... khóa")
        if (docs.length === 0) docs = await runSearch({ phrase: { query, path: 'description' } });
        return { ids: docs.map(d => d._id), scores: docs.map(d => d.s) };
    } catch (err: any) {
        logger.warn(`Atlas Search lỗi, dùng regex: ${err.message}`);
        return null;
    }
}
