import type { SearchProductsParams } from './product.dto';

export function shouldLogSearch(
    q: string,
    page: number,
    p: Pick<SearchProductsParams, 'sort' | 'category' | 'minPrice' | 'maxPrice'>
): boolean {
    const isDefaultSort = !p.sort || p.sort === 'relevance';
    return q.length >= 2 && page === 1 && isDefaultSort && !p.category && !p.minPrice && !p.maxPrice;
}
