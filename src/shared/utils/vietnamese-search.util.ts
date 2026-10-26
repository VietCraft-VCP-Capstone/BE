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

const MARKS = '[̀-ͯ]*';
const ACCENT_GROUPS: Record<string, string> = {
    a: 'aàáảãạăằắẳẵặâầấẩẫậ',
    e: 'eèéẻẽẹêềếểễệ',
    i: 'iìíỉĩị',
    o: 'oòóỏõọôồốổỗộơờớởỡợ',
    u: 'uùúủũụưừứửữự',
    y: 'yỳýỷỹỵ',
    d: 'dđ',
};

/** Regex source (lowercased NFC input): unaccented letter matches all accents, accented letter matches only itself. */
export function accentInsensitive(str: string): string {
    if (!str || typeof str !== 'string') return '';
    return [...str].map(c => {
        if (ACCENT_GROUPS[c]) return `[${ACCENT_GROUPS[c]}]${MARKS}`;
        const nfd = c.normalize('NFD');
        return nfd !== c ? `(?:${escapeRegex(c)}|${escapeRegex(nfd)})` : escapeRegex(c);
    }).join('');
}

export function extractSearchTerms(query: string, maxTerms = 8): string[] {
    const norm = normalizeVi(query);
    if (!norm) return [];
    return [...new Set(norm.split(' ').filter(Boolean))].slice(0, maxTerms);
}
