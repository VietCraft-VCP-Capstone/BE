import type { SearchProductsParams } from './product.dto';

export function shouldLogSearch(
    q: string,
    page: number,
    p: Pick<SearchProductsParams, 'sort' | 'category' | 'minPrice' | 'maxPrice'>
): boolean {
    const isDefaultSort = !p.sort || p.sort === 'relevance';
    return q.length >= 2 && page === 1 && isDefaultSort && !p.category && !p.minPrice && !p.maxPrice;
}

export interface SuggestCandidate {
    title_norm?: string;
    tags_norm?: string[];
    average_rating?: number;
    rating_count?: number;
    created_at?: Date | string;
}

export const SUGGEST_PROJECTION = {
    title: 1, slug: 1, images: 1, min_price: 1, original_price: 1,
    average_rating: 1, rating_count: 1, title_norm: 1, tags_norm: 1, created_at: 1,
};

export function effectiveRating(p: SuggestCandidate): number {
    return (p.rating_count ?? 0) > 0 ? (p.average_rating ?? 0) : 0;
}

export function scoreSuggestion(p: SuggestCandidate, norm: string, terms: string[]): number {
    const titleNorm = p.title_norm || '';
    const titleWords = titleNorm.split(' ');
    const tags = Array.isArray(p.tags_norm) ? p.tags_norm : [];

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
