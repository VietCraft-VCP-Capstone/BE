import { nfcLower, normalizeVi } from '../../../shared/utils/vietnamese-search.util';

export interface QueryRow {
    query: string;
    searches: number;
}

export interface QueryInsight extends QueryRow {
    covered: boolean;
    actual_rank: number | null;
    match_gain: number;
}

export interface ZeroResultInsight extends QueryRow {
    match_gain: number;
}

export const TITLE_GAIN = 5;
export const TAG_GAIN = 3;

export function matchGain(query: string, title: string, tags: string[]): number {
    const q = normalizeVi(query);
    if (!q) return 0;
    if (!normalizeVi(title).includes(q)) return TITLE_GAIN;
    return tags.some(t => normalizeVi(t).includes(q)) ? 0 : TAG_GAIN;
}

export function actualRank(orderedIds: string[], productId: string): number | null {
    const i = orderedIds.indexOf(productId);
    return i === -1 ? null : i + 1;
}

export function lexicallyCovered(query: string, title: string, tags: string[]): boolean {
    const have = new Set(normalizeVi([title, ...tags].join(' ')).split(' '));
    const need = normalizeVi(query).split(' ').filter(Boolean);
    return need.length > 0 && need.every(w => have.has(w));
}

export function queryInsights(
    rows: (QueryRow & { actual_rank: number | null })[],
    title: string,
    tags: string[],
): QueryInsight[] {
    return rows
        .map(r => {
            const covered = lexicallyCovered(r.query, title, tags);
            return { query: r.query, searches: r.searches, covered, actual_rank: r.actual_rank, match_gain: covered ? 0 : matchGain(r.query, title, tags) };
        })
        .sort((a, b) => b.searches - a.searches || a.query.localeCompare(b.query));
}

const accentTokens = (text: string) => nfcLower(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const GENERIC = new Set('nam nữ unisex bé trẻ em người lớn đẹp cao cấp form rộng size màu đen trắng xanh đỏ hồng vàng nâu xám be set bộ mới hot giá rẻ cho và của thời trang phong cách chính hãng in hình'.split(' '));

export function aboutProduct(query: string, category: string, title: string, tags: string[]): boolean {
    const own = new Set(accentTokens([title, ...tags].join(' ')));
    const words = new Set([...own, ...accentTokens(category)]);
    const need = accentTokens(query);
    return need.some(w => own.has(w) && !GENERIC.has(w)) && need.filter(w => words.has(w)).length * 2 >= need.length;
}

export function zeroResultInsights(rows: QueryRow[], category: string, title: string, tags: string[], limit = 5): ZeroResultInsight[] {
    return rows
        .filter(r => aboutProduct(r.query, category, title, tags))
        .slice(0, limit)
        .map(r => ({ query: r.query, searches: r.searches, match_gain: matchGain(r.query, title, tags) }));
}
