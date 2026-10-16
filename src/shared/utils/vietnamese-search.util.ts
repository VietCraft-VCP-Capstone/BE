/**
 * Vietnamese Search & Text Normalization Utilities for VietCraft
 */

/**
 * Convert string to Unicode NFC normalized and lowercase.
 */
export function nfcLower(str: string): string {
    if (!str || typeof str !== 'string') return '';
    return str.normalize('NFC').toLowerCase().trim();
}

/**
 * Check if the text contains any non-ASCII character (Vietnamese accented characters).
 */
export function hasTone(str: string): boolean {
    if (!str) return false;
    return /[^\u0000-\u007f]/.test(nfcLower(str));
}

/**
 * Remove Vietnamese accents / diacritics and normalize punctuation.
 * e.g. "Bộ Ly Gốm Mộc Men Lam (Set 2)" -> "bo ly gom moc men lam set 2"
 */
export function normalizeVi(str: string): string {
    if (!str || typeof str !== 'string') return '';
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove combining diacritical marks
        .replace(/[đĐ]/g, 'd')           // Normalize Vietnamese letter D with stroke
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')    // Replace special characters / punctuation with space
        .replace(/\s+/g, ' ')            // Collapse multiple spaces
        .trim();
}

/**
 * Escape special regex characters.
 */
export function escapeRegex(str: string): string {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Tokenize a search query into distinct terms (up to 8 terms).
 */
export function extractSearchTerms(query: string, maxTerms = 8): string[] {
    const norm = normalizeVi(query);
    if (!norm) return [];
    return [...new Set(norm.split(' ').filter(Boolean))].slice(0, maxTerms);
}

/**
 * Generate word prefixes and 2-word phrase prefixes for autocomplete & fallback.
 * e.g. for words ["ly", "gom", "bat", "trang"], returns:
 * - word prefixes: "ly", "go", "gom", "ba", "bat", "tr", "tra", "trang"
 * - 2-word combinations & prefixes: "ly gom", "gom bat", "bat trang", "bat tr"
 */
export function buildPrefixes(normText: string, minLen = 2, maxLen = 12): string[] {
    if (!normText) return [];
    const words = normText.split(' ').filter(w => w.length >= minLen);
    const prefixes = new Set<string>();

    // 1. Single word prefixes
    for (const w of words) {
        const limit = Math.min(w.length, maxLen);
        for (let i = minLen; i <= limit; i++) {
            prefixes.add(w.slice(0, i));
        }
    }

    // 2. Consecutive 2-word phrases and their prefixes (e.g. "bat trang", "ly gom")
    for (let i = 0; i < words.length - 1; i++) {
        const phrase = `${words[i]} ${words[i + 1]}`;
        prefixes.add(phrase);
        const pLen = Math.min(phrase.length, 16);
        for (let len = words[i].length + 2; len <= pLen; len++) {
            prefixes.add(phrase.slice(0, len));
        }
    }

    return Array.from(prefixes);
}

