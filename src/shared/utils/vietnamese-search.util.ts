export function nfcLower(str: string): string {
    if (!str || typeof str !== 'string') return '';
    return str.normalize('NFC').toLowerCase().trim();
}

export function hasTone(str: string): boolean {
    if (!str) return false;
    return /[^\u0000-\u007f]/.test(nfcLower(str));
}

/** "Bộ Ly Gốm Mộc (Set 2)" -> "bo ly gom moc set 2" */
export function normalizeVi(str: string): string {
    if (!str || typeof str !== 'string') return '';
    return str
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[đĐ]/g, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function escapeRegex(str: string): string {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractSearchTerms(query: string, maxTerms = 8): string[] {
    const norm = normalizeVi(query);
    if (!norm) return [];
    return [...new Set(norm.split(' ').filter(Boolean))].slice(0, maxTerms);
}

/** "bat trang" -> ["ba", "bat", "tr", "tra", ..., "bat trang", "bat t", ...]: tiền tố từng từ và cụm 2 từ liền nhau. */
export function buildPrefixes(normText: string, minLen = 2, maxLen = 12): string[] {
    if (!normText) return [];
    const words = normText.split(' ').filter(w => w.length >= minLen);
    const prefixes = new Set<string>();

    for (const w of words) {
        const limit = Math.min(w.length, maxLen);
        for (let i = minLen; i <= limit; i++) {
            prefixes.add(w.slice(0, i));
        }
    }

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
