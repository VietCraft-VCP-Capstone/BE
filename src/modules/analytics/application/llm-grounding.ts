// LLM chỉ được diễn giải: mọi con số trong câu trả lời phải có trong dữ liệu đầu vào của prompt.

const SMALL_COUNT_MAX = 10; // "set 2 món", "3 bước" là số đếm chung, không phải số liệu
const TOLERANCE = 0.02;

const NUM_RE = /(\d{1,3}(?:\.\d{3})+|\d+(?:,\d+)?)(?:\s*(triệu|tr|nghìn|k)\b)?/gi;
const DATE_RE = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;

/** Các số trong đoạn văn (đã đổi đơn vị k/nghìn/triệu); bỏ ngày dd/mm và số đếm nhỏ. */
export function extractNumbers(text: string): number[] {
    const clean = String(text || '').replace(DATE_RE, ' ');
    const out: number[] = [];
    for (const m of clean.matchAll(NUM_RE)) {
        const raw = m[1];
        let n = raw.includes('.') && /^\d{1,3}(\.\d{3})+$/.test(raw) ? Number(raw.replace(/\./g, '')) : Number(raw.replace(',', '.'));
        const unit = (m[2] || '').toLowerCase();
        if (unit === 'k' || unit === 'nghìn') n *= 1_000;
        if (unit === 'tr' || unit === 'triệu') n *= 1_000_000;
        if (!Number.isFinite(n)) continue;
        if (Number.isInteger(n) && n <= SMALL_COUNT_MAX && !unit) continue;
        out.push(n);
    }
    return out;
}

/** Mọi giá trị số (kể cả chuỗi số) trong một object lồng nhau. */
export function numericValues(input: unknown, acc: number[] = []): number[] {
    if (typeof input === 'number' && Number.isFinite(input)) acc.push(input);
    else if (typeof input === 'string' && /^-?\d+(\.\d+)?$/.test(input.trim())) acc.push(Number(input));
    else if (Array.isArray(input)) input.forEach(v => numericValues(v, acc));
    else if (input && typeof input === 'object') Object.values(input).forEach(v => numericValues(v, acc));
    return acc;
}

/** Các số trong `text` không khớp (±2%) với số nào trong `allowed`. Rỗng = đạt. */
export function ungroundedNumbers(text: string, allowed: number[]): number[] {
    const pool = allowed.flatMap(a => [a, Math.abs(a)]);
    return extractNumbers(text).filter(n => !pool.some(a => Math.abs(n - a) <= Math.max(0.5, TOLERANCE * Math.abs(a))));
}

/** true nếu mọi đoạn văn đều chỉ dùng số có trong dữ liệu đầu vào. */
export function isGrounded(texts: Array<string | undefined | null>, inputData: unknown): boolean {
    const allowed = numericValues(inputData);
    return texts.every(t => !t || ungroundedNumbers(t, allowed).length === 0);
}
