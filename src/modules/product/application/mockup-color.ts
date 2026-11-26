/**
 * Xử lý pixel cho mockup theo màu (không I/O, test được).
 *
 * Quy trình: biết mask phôi (255 = phôi, 0 = nền) -> chỉ đổi màu trong mask, giữ độ sáng tối
 * của ảnh gốc (nếp vải, bóng trên phôi) -> nền và bóng đổ ngoài phôi giữ nguyên.
 */

export const CANVAS = 800;

export const COLOR_MAP: Record<string, string> = {
    'đen': '#18181b',
    'black': '#18181b',
    'đen huyền bí': '#18181b',
    'đen mộc': '#27272a',
    'trắng': '#ffffff',
    'white': '#ffffff',
    'trắng men mờ': '#ffffff',
    'kem tự nhiên': '#fdfbf7',
    'kem': '#fef3c7',
    'be': '#f5f5dc',
    'beige': '#f5f5dc',
    'nâu': '#78350f',
    'nâu gỗ': '#6b4226',
    'nâu đất': '#5c3a21',
    'gỗ sồi tự nhiên': '#d4a373',
    'gỗ nâu óc chó': '#582f0e',
    'xám': '#6b7280',
    'xám melange': '#9ca3af',
    'ghi': '#9ca3af',
    'xám tiêu': '#9ca3af',
    'xanh navy': '#1e3a8a',
    'navy': '#1e3a8a',
    'xanh than': '#172554',
    'xanh rêu': '#14532d',
    'xanh lá': '#15803d',
    'xanh dương': '#2563eb',
    'xanh cobalt': '#1d4ed8',
    'đỏ': '#dc2626',
    'đỏ đô': '#991b1b',
    'đỏ tươi': '#ef4444',
    'vàng': '#ca8a04',
    'vàng mù tạt': '#a16207',
    'hồng': '#db2777',
    'hồng phấn': '#f472b6',
    'cam': '#ea580c',
    'tím': '#7e22ce'
};

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
// Khoá dài trước để "xanh navy" thắng "navy", "đỏ đô" thắng "đỏ".
const NAME_KEYS = Object.keys(COLOR_MAP).sort((a, b) => b.length - a.length);

export function normalizeHex(hex: string): string {
    const h = hex.trim().toLowerCase();
    return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const h = normalizeHex(hex).slice(1);
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function isNearWhite(hex: string): boolean {
    const { r, g, b } = hexToRgb(hex);
    return r > 242 && g > 242 && b > 242;
}

function hexFromName(name?: string): string | undefined {
    if (!name || typeof name !== 'string') return undefined;
    const lower = name.trim().toLowerCase();
    if (COLOR_MAP[lower]) return COLOR_MAP[lower];
    const hit = NAME_KEYS.find(k => new RegExp(`(^|\\s)${k}(\\s|$)`).test(lower));
    return hit ? COLOR_MAP[hit] : undefined;
}

/**
 * Mã màu của một màu phôi. Ưu tiên mã hex xưởng khai báo, trừ trường hợp hex là trắng mặc định
 * (#FFFFFF do schema cũ tự điền) trong khi tên màu rõ ràng không phải trắng, ví dụ "Đen".
 */
export function resolveColorHex(colorName?: string, hex?: string): string | undefined {
    const valid = hex && typeof hex === 'string' && HEX_RE.test(hex.trim()) ? normalizeHex(hex) : undefined;
    const fromName = hexFromName(colorName);
    if (valid && !(isNearWhite(valid) && fromName && !isNearWhite(fromName))) return valid;
    return fromName ?? valid;
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Mask từ kênh alpha nếu ảnh thật sự có vùng trong suốt; ngược lại null. */
export function maskFromAlpha(rgba: Uint8Array, W: number, H: number): Uint8Array | null {
    const n = W * H;
    let transparent = 0;
    for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] < 250) transparent++;
    if (transparent < n * 0.01) return null;
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = rgba[i * 4 + 3];
    return m;
}

/** Mask từ ảnh xám (mask do AI trả, hoặc xưởng tải lên): trắng = phôi. */
export function maskFromGray(rgba: Uint8Array, W: number, H: number): Uint8Array {
    const n = W * H;
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        m[i] = Math.round(lum(rgba[o], rgba[o + 1], rgba[o + 2]) * (rgba[o + 3] / 255));
    }
    return m;
}

export function maskCoverage(mask: Uint8Array): number {
    let c = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i] > 127) c++;
    return c / mask.length;
}

/**
 * Mask dự phòng khi không có AI: loang từ mép ảnh, pixel nền lan sang pixel kề nếu màu gần nhau.
 * So với pixel kề (không phải một màu nền trung bình) nên nền chuyển màu và bóng đổ mềm vẫn được
 * tính là nền; viền phôi có độ tương phản nên chặn được vết loang.
 */
export function heuristicMask(rgba: Uint8Array, W: number, H: number, localThreshold = 12): Uint8Array {
    const n = W * H;
    const bg = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0, tail = 0;
    const push = (i: number) => { if (!bg[i]) { bg[i] = 1; queue[tail++] = i; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }

    const t2 = localThreshold * localThreshold;
    const near = (a: number, b: number) => {
        const oa = a * 4, ob = b * 4;
        if (rgba[oa + 3] < 16 && rgba[ob + 3] < 16) return true;
        const dr = rgba[oa] - rgba[ob], dg = rgba[oa + 1] - rgba[ob + 1], db = rgba[oa + 2] - rgba[ob + 2];
        return dr * dr + dg * dg + db * db < t2;
    };
    while (head < tail) {
        const i = queue[head++];
        const x = i % W, y = (i - x) / W;
        if (x > 0 && !bg[i - 1] && near(i, i - 1)) push(i - 1);
        if (x < W - 1 && !bg[i + 1] && near(i, i + 1)) push(i + 1);
        if (y > 0 && !bg[i - W] && near(i, i - W)) push(i - W);
        if (y < H - 1 && !bg[i + W] && near(i, i + W)) push(i + W);
    }
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = bg[i] ? 0 : 255;
    return m;
}

function percentileLum(rgba: Uint8Array, mask: Uint8Array | null, p: number, box?: Box, W = CANVAS): number {
    const hist = new Uint32Array(256);
    let total = 0;
    for (let i = 0; i < rgba.length / 4; i++) {
        if (mask && mask[i] < 200) continue;
        if (box) {
            const x = i % W, y = (i - x) / W;
            if (x < box.x || y < box.y || x >= box.x + box.width || y >= box.y + box.height) continue;
        }
        const o = i * 4;
        if (rgba[o + 3] < 128) continue;
        hist[Math.round(lum(rgba[o], rgba[o + 1], rgba[o + 2]))]++;
        total++;
    }
    if (!total) return 230;
    const target = total * p;
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return Math.max(v, 1); }
    return 255;
}

export interface Box { x: number; y: number; width: number; height: number }

/**
 * Đổi màu phôi trong mask, giữ chi tiết sáng tối.
 * s = độ sáng pixel / độ sáng trung vị của phôi. s ≤ 1 (nếp, bóng) -> tối dần theo màu đích;
 * s > 1 (chỗ sáng) -> ngả nhẹ về trắng. Viền mask mềm được trộn với ảnh gốc.
 */
export function recolorInMask(rgba: Uint8Array, mask: Uint8Array, targetHex: string): Uint8Array {
    const { r: tR, g: tG, b: tB } = hexToRgb(targetHex);
    const ref = percentileLum(rgba, mask, 0.5);
    const out = new Uint8Array(rgba.length);
    for (let i = 0; i < mask.length; i++) {
        const o = i * 4;
        const a = mask[i] / 255;
        const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
        out[o + 3] = rgba[o + 3];
        if (a <= 0) { out[o] = r; out[o + 1] = g; out[o + 2] = b; continue; }
        const s = Math.min(1.6, lum(r, g, b) / ref);
        let nr: number, ng: number, nb: number;
        if (s <= 1) {
            nr = tR * s; ng = tG * s; nb = tB * s;
        } else {
            const k = Math.min(1, (s - 1) * 0.6);
            nr = tR + (255 - tR) * k; ng = tG + (255 - tG) * k; nb = tB + (255 - tB) * k;
        }
        out[o] = Math.round(r + (nr - r) * a);
        out[o + 1] = Math.round(g + (ng - g) * a);
        out[o + 2] = Math.round(b + (nb - b) * a);
    }
    return out;
}

/**
 * Bản đồ bóng để hoà thiết kế vào nếp phôi (dùng với blend multiply): 255 = giữ nguyên,
 * thấp hơn = tối đi theo nếp. Chỉ làm tối, độ mạnh `strength`.
 */
export function shadingMap(rgba: Uint8Array, mask: Uint8Array | null, box: Box | undefined, W = CANVAS, strength = 0.55): Uint8Array {
    const ref = percentileLum(rgba, mask, 0.6, box, W);
    const n = rgba.length / 4;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (mask && mask[i] < 16) { out[i] = 255; continue; }
        const s = Math.max(0.5, Math.min(1, lum(rgba[o], rgba[o + 1], rgba[o + 2]) / ref));
        out[i] = Math.round(255 - (255 - s * 255) * strength);
    }
    return out;
}
