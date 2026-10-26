import type { PipelineStage, Types } from 'mongoose';
import { accentInsensitive } from '../../../shared/utils/vietnamese-search.util';

export interface SearchPipelineOptions {
    match: Record<string, any>;
    q: string;
    priceStock: Record<string, any>;
    sort: Record<string, any>;
    withSold: boolean;
    page: number;
    limit: number;
    searchHits?: { ids: Types.ObjectId[]; scores: number[] };
}

export const TIER_BOOST = {
    $switch: {
        branches: [
            { case: { $eq: ['$_reputationTier', 'TRUSTED'] }, then: 2.0 },
            { case: { $eq: ['$_reputationTier', 'NORMAL'] }, then: 1.0 },
            { case: { $eq: ['$_reputationTier', 'WARNING'] }, then: -1.5 },
        ],
        default: 0.0,
    },
};

/** Mỗi từ phải có trong title/tags/categories; bỏ description vì dễ khớp nhầm (vd. "thời trang"). */
export function buildTermsMatch(terms: string[]): Record<string, any>[] {
    return terms.map(t => {
        const re = { $regex: accentInsensitive(t), $options: 'i' };
        return { $or: [{ title: re }, { tags: re }, { categories: re }] };
    });
}

function arrayHas(field: string, regex: string): object {
    return {
        $anyElementTrue: [{
            $map: { input: { $ifNull: [field, []] }, as: 'x', in: { $regexMatch: { input: '$$x', regex, options: 'i' } } },
        }],
    };
}

export function buildRelevance(q: string, searchHits?: SearchPipelineOptions['searchHits']): object {
    const parts: any[] = [TIER_BOOST, { $multiply: ['$_rating', 0.3] }];
    if (searchHits) {
        const { ids, scores } = searchHits;
        parts.push({ $ifNull: [{ $arrayElemAt: [scores, { $indexOfArray: [ids, '$_id'] }] }, 0] });
    }
    if (q) {
        const regex = accentInsensitive(q);
        parts.push(
            { $cond: [{ $regexMatch: { input: { $ifNull: ['$title', ''] }, regex, options: 'i' } }, 5, 0] },
            { $cond: [arrayHas('$tags', regex), 3, 0] },
            { $cond: [arrayHas('$categories', regex), 2, 0] },
        );
    }
    return { $add: parts };
}

export const VARIANT_LOOKUP: PipelineStage = {
    $lookup: {
        from: 'product_variants',
        let: { pid: '$_id' },
        pipeline: [
            { $match: { $expr: { $eq: ['$product_id', '$$pid'] }, is_active: { $ne: false } } },
            { $group: { _id: null, min: { $min: { $toDouble: '$retail_price' } }, max: { $max: { $toDouble: '$retail_price' } }, stock: { $sum: '$stock_quantity' } } },
        ],
        as: '_v',
    },
};

// shortcut: sort chưa trừ món hoàn tiền như getSoldCounts, đủ cho thứ tự; gộp lại nếu cần số chính xác
const SOLD_LOOKUP: PipelineStage = {
    $lookup: {
        from: 'orders',
        let: { pid: '$_id' },
        pipeline: [
            { $match: { order_status: 'DELIVERED', refund_status: { $ne: 'REFUNDED' } } },
            { $unwind: '$items' },
            { $match: { $expr: { $eq: ['$items.product_id', '$$pid'] } } },
            { $group: { _id: null, n: { $sum: '$items.quantity' } } },
        ],
        as: '_s',
    },
};

export function buildSearchPipeline(o: SearchPipelineOptions): PipelineStage[] {
    return [
        { $match: o.match },
        {
            $lookup: {
                from: 'shops',
                localField: 'shop_id',
                foreignField: '_id',
                as: '_shop',
                pipeline: [{ $project: { reputation_tier: 1 } }],
            },
        },
        VARIANT_LOOKUP,
        {
            $addFields: {
                _reputationTier: { $ifNull: [{ $arrayElemAt: ['$_shop.reputation_tier', 0] }, 'NORMAL'] },
                // Sản phẩm chưa có đánh giá thật (rating_count = 0) coi như rating 0
                _rating: { $cond: [{ $gt: [{ $ifNull: ['$rating_count', 0] }, 0] }, { $ifNull: ['$average_rating', 0] }, 0] },
                _minPrice: { $ifNull: [{ $arrayElemAt: ['$_v.min', 0] }, 0] },
                _maxPrice: { $ifNull: [{ $arrayElemAt: ['$_v.max', 0] }, 0] },
                _totalStock: { $ifNull: [{ $arrayElemAt: ['$_v.stock', 0] }, 0] },
            },
        },
        { $match: { _reputationTier: { $ne: 'RESTRICTED' }, ...o.priceStock } },
        { $addFields: { _relevance: buildRelevance(o.q, o.searchHits) } },
        ...(o.withSold ? [SOLD_LOOKUP, { $addFields: { _sold: { $ifNull: [{ $arrayElemAt: ['$_s.n', 0] }, 0] } } }] : []),
        { $project: { description: 0, design_placements: 0, _shop: 0, _v: 0, _s: 0 } },
        { $sort: o.sort },
        {
            $facet: {
                items: [{ $skip: (o.page - 1) * o.limit }, { $limit: o.limit }],
                total: [{ $count: 'n' }],
            },
        },
    ];
}
