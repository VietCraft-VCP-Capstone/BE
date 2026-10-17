import type { PipelineStage } from 'mongoose';
import { escapeRegex } from '../../../shared/utils/vietnamese-search.util';

export interface RelevanceOptions {
    norm: string;
    qLower: string;
    queryHasTone: boolean;
    withTextScore: boolean;
}

const TIER_BOOST = {
    $switch: {
        branches: [
            { case: { $eq: ['$_reputationTier', 'TRUSTED'] }, then: 2.0 },
            { case: { $eq: ['$_reputationTier', 'NORMAL'] }, then: 1.0 },
            { case: { $eq: ['$_reputationTier', 'WARNING'] }, then: -1.5 },
        ],
        default: 0.0,
    },
};

export function buildRelevance(o: RelevanceOptions): object {
    const hasText = o.norm !== '';
    return {
        $add: [
            o.withTextScore ? { $meta: 'textScore' } : 0,
            hasText ? { $cond: [{ $regexMatch: { input: '$title_norm', regex: escapeRegex(o.norm) } }, 3, 0] } : 0,
            hasText && o.queryHasTone ? { $cond: [{ $regexMatch: { input: '$title_lc', regex: escapeRegex(o.qLower) } }, 4, 0] } : 0,
            TIER_BOOST,
            { $multiply: ['$_rating', 0.3] },
            { $multiply: [{ $ln: { $add: [{ $ifNull: ['$sold_count', 0] }, 1] } }, 0.2] },
        ],
    };
}

export function buildSearchPipeline(match: Record<string, any>, relevance: object, sort: Record<string, any>, page: number, limit: number): PipelineStage[] {
    return [
        { $match: match },
        {
            $lookup: {
                from: 'shops',
                localField: 'shop_id',
                foreignField: '_id',
                as: '_shop',
                pipeline: [{ $project: { reputation_score: 1, reputation_tier: 1 } }],
            },
        },
        {
            $addFields: {
                _reputationScore: { $ifNull: [{ $arrayElemAt: ['$_shop.reputation_score', 0] }, 80] },
                _reputationTier: { $ifNull: [{ $arrayElemAt: ['$_shop.reputation_tier', 0] }, 'NORMAL'] },
                // Sản phẩm chưa có đánh giá thật (rating_count = 0) coi như rating 0
                _rating: { $cond: [{ $gt: [{ $ifNull: ['$rating_count', 0] }, 0] }, { $ifNull: ['$average_rating', 0] }, 0] },
            },
        },
        { $match: { _reputationTier: { $ne: 'RESTRICTED' } } },
        { $addFields: { _relevance: relevance } },
        {
            $project: {
                title_prefixes: 0,
                description: 0,
                description_norm: 0,
                design_placements: 0,
                _shop: 0,
            },
        },
        { $sort: sort },
        {
            $facet: {
                items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
                total: [{ $count: 'n' }],
            },
        },
    ];
}
