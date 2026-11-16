import { Types, type PipelineStage } from 'mongoose';
import { Product as MongoProduct } from '../../infrastructure/models/product.model';
import { VARIANT_LOOKUP, TIER_BOOST } from '../product-search.pipeline';
import { accentInsensitive } from '../../../../shared/utils/vietnamese-search.util';
import { Profile } from './user-profile';

const HEALTH_LOOKUP: PipelineStage = {
    $lookup: {
        from: 'listing_health_scores',
        let: { pid: '$_id' },
        pipeline: [
            { $match: { $expr: { $eq: ['$product_id', '$$pid'] } } },
            { $sort: { date: -1 } },
            { $limit: 1 },
            { $project: { score: 1, _id: 0 } },
        ],
        as: '_h',
    },
};

/** Ứng viên đã lọc RESTRICTED và READY_TO_SHIP hết hàng, kèm giá, health, tier. Dữ liệu đọc, không ghi. */
export function buildCandidatePipeline(
    match: Record<string, any>,
    size: number,
    sort: Record<string, 1 | -1> = { created_at: -1 },
): PipelineStage[] {
    return [
        { $match: match },
        { $sort: sort },
        { $limit: size },
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
        HEALTH_LOOKUP,
        {
            $addFields: {
                _reputationTier: { $ifNull: [{ $arrayElemAt: ['$_shop.reputation_tier', 0] }, 'NORMAL'] },
                _rating: { $cond: [{ $gt: [{ $ifNull: ['$rating_count', 0] }, 0] }, { $ifNull: ['$average_rating', 0] }, 0] },
                _minPrice: { $ifNull: [{ $arrayElemAt: ['$_v.min', 0] }, 0] },
                _totalStock: { $ifNull: [{ $arrayElemAt: ['$_v.stock', 0] }, 0] },
                _health: { $arrayElemAt: ['$_h.score', 0] },
            },
        },
        {
            $match: {
                _reputationTier: { $ne: 'RESTRICTED' },
                $or: [{ product_type: { $ne: 'READY_TO_SHIP' } }, { _totalStock: { $gt: 0 } }],
            },
        },
        { $addFields: { _tierBoost: TIER_BOOST } },
        { $project: { description: 0, design_placements: 0, _shop: 0, _v: 0, _h: 0 } },
    ];
}

export async function fetchCandidates(match: Record<string, any>, size = 200, sort?: Record<string, 1 | -1>): Promise<any[]> {
    return MongoProduct.aggregate(buildCandidatePipeline(match, size, sort), { allowDiskUse: true });
}

/** Mệnh đề $or cho gu: danh mục top, tag top, shop đã follow, và từ khoá khớp title/tags/categories (không phân biệt dấu). */
export function tasteClauses(p: Profile, keywords: string[], followedShopIds: string[] = []): Record<string, any>[] {
    const out: Record<string, any>[] = [];
    const shops = followedShopIds.filter(id => Types.ObjectId.isValid(id)).map(id => new Types.ObjectId(id));
    if (shops.length) out.push({ shop_id: { $in: shops } });
    if (p.topCategories.length) out.push({ categories: { $in: p.topCategories } });
    if (p.topTags.length) out.push({ tags: { $in: p.topTags } });
    for (const k of keywords) {
        const re = { $regex: accentInsensitive(k), $options: 'i' };
        out.push({ title: re }, { tags: re }, { categories: re });
    }
    return out;
}
