const MAX_ITEMS = 5;
const MAX_CHARS = 40;

export function normalizeMaterials(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of raw) {
        if (typeof item !== 'string') continue;
        const value = Array.from(item.normalize('NFC').trim()).slice(0, MAX_CHARS).join('').trim();
        const key = value.toLowerCase();
        if (!value || seen.has(key)) continue;
        seen.add(key);
        out.push(value);
        if (out.length === MAX_ITEMS) break;
    }
    return out;
}
