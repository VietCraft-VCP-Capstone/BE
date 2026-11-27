import type { SearchProductsParams } from './product.dto';
import { normalizeVi } from '../../../shared/utils/vietnamese-search.util';

export function shouldLogSearch(
    q: string,
    page: number,
    p: Pick<SearchProductsParams, 'sort' | 'category' | 'productType' | 'craftType' | 'location' | 'rating' | 'minPrice' | 'maxPrice' | 'inStockOnly'>
): boolean {
    const isDefaultSort = !p.sort || p.sort === 'relevance';
    const hasWordChars = (q.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2;
    const isAllCategory = !p.category || p.category === 'ALL' || p.category === 'Tất cả danh mục';
    const isAllType = (v?: string) => !v || v === 'ALL';
    const noRating = String(p.rating ?? '') === '';
    return hasWordChars && page === 1 && isDefaultSort && isAllCategory && isAllType(p.productType) && isAllType(p.craftType)
        && !p.location?.trim() && noRating && p.inStockOnly !== true && p.inStockOnly !== 'true' && !p.minPrice && !p.maxPrice;
}

export interface SuggestCandidate {
    title?: string;
    tags?: string[];
    average_rating?: number;
    rating_count?: number;
    created_at?: Date | string;
}

export const SUGGEST_PROJECTION = {
    title: 1, average_rating: 1, rating_count: 1, tags: 1, created_at: 1,
};

export function effectiveRating(p: SuggestCandidate): number {
    return (p.rating_count ?? 0) > 0 ? (p.average_rating ?? 0) : 0;
}

export function scoreSuggestion(p: SuggestCandidate, norm: string, terms: string[]): number {
    const titleNorm = normalizeVi(p.title || '');
    const titleWords = titleNorm.split(' ');
    const tags = Array.isArray(p.tags) ? p.tags.map(normalizeVi) : [];

    if (titleNorm.startsWith(norm)) return 25;
    if (titleWords.includes(norm) || (terms.length > 0 && terms.every(t => titleWords.includes(t)))) return 18;
    if (tags.includes(norm)) return 14;
    if (tags.some(t => t.includes(norm))) return 8;
    if (titleNorm.includes(norm)) return 5;
    return 1;
}

export function rankSuggestions<T extends SuggestCandidate>(items: T[], norm: string, terms: string[], take = 4): T[] {
    return items
        .map(item => ({
            item,
            score: scoreSuggestion(item, norm, terms),
            rating: effectiveRating(item),
            created: item.created_at ? new Date(item.created_at).getTime() : 0,
        }))
        .sort((a, b) => b.score - a.score || b.rating - a.rating || b.created - a.created)
        .slice(0, take)
        .map(x => x.item);
}
