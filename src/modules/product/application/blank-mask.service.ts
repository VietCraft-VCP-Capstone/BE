import crypto from 'crypto';
import sharp from 'sharp';
import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';
import { BlankMask } from '../infrastructure/models/mockup-cache.model';
import { CANVAS, heuristicMask, maskCoverage, maskFromAlpha, maskFromGray } from './mockup-color';

/**
 * Nguồn của vùng phôi (mask), theo độ tin cậy giảm dần:
 *  printer_custom    xưởng tải PNG nền trong suốt / mask riêng
 *  printer_confirmed xưởng đã xem và xác nhận mask tự động
 *  printer_auto      mask tự động xưởng đã tạo nhưng chưa xác nhận
 *  ai                sàn tự tách bằng AI (BiRefNet), chưa ai xác nhận
 *  heuristic         AI không chạy được, ước lượng bằng loang màu từ mép ảnh
 */
export type MaskSource = 'printer_custom' | 'printer_confirmed' | 'printer_auto' | 'ai' | 'heuristic';

export interface PreparedBase {
    rgba: Uint8Array;   // CANVAS×CANVAS×4
    mask: Uint8Array;   // CANVAS×CANVAS
    source: MaskSource;
    key: string;        // đổi khi ảnh hoặc mask đổi; dùng làm khoá cache render
}

export interface AreaMaskInfo {
    mask_image?: string;
    mask_status?: 'auto' | 'confirmed' | 'custom' | string;
}

const sha1 = (s: string | Buffer) => crypto.createHash('sha1').update(s).digest('hex');

async function toCanvasRgba(buf: Buffer): Promise<Uint8Array> {
    const raw = await sharp(buf).resize(CANVAS, CANVAS, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
}

/** Làm mềm viền mask 1px để chỗ giáp nền không bị răng cưa. */
async function softenMask(mask: Uint8Array): Promise<Uint8Array> {
    const out = await sharp(Buffer.from(mask), { raw: { width: CANVAS, height: CANVAS, channels: 1 } })
        // sharp xuất 3 kênh sau blur nếu không ép lại 1 kênh -> mask bị đọc lệch
        .blur(0.8).extractChannel(0).raw().toBuffer();
    if (out.length !== CANVAS * CANVAS) throw new Error(`mask sai kích thước: ${out.length}`);
    return new Uint8Array(out.buffer, out.byteOffset, out.length);
}

async function maskPngToCanvas(png: Buffer): Promise<Uint8Array> {
    const rgba = await toCanvasRgba(png);
    return maskFromAlpha(rgba, CANVAS, CANVAS) ?? maskFromGray(rgba, CANVAS, CANVAS);
}

// ---------- gọi AI tách nền ----------

const inflight = new Map<string, Promise<Buffer | null>>();
let aiDownLoggedAt = 0;

export async function segmentWithAi(imageBuf: Buffer): Promise<{ png: Buffer; model?: string; coverage?: number } | null> {
    if (!config.aiAnalyticsUrl) return null;
    try {
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(imageBuf)]), 'blank.png');
        const res = await fetch(`${config.aiAnalyticsUrl}/api/internal/vision/segment`, {
            method: 'POST',
            body: form,
            headers: config.aiGatewaySecret ? { 'X-Gateway-Secret': config.aiGatewaySecret } : {},
            // lần đầu nạp model mất ~20s, ảnh lớn trên CPU thêm vài giây
            signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) throw new Error(`AI segment ${res.status}`);
        return {
            png: Buffer.from(await res.arrayBuffer()),
            model: res.headers.get('x-seg-model') || undefined,
            coverage: Number(res.headers.get('x-seg-coverage')) || undefined,
        };
    } catch (err: any) {
        if (Date.now() - aiDownLoggedAt > 60_000) {
            aiDownLoggedAt = Date.now();
            logger.warn(`[MOCKUP] Không gọi được AI tách nền (${err?.message || err}); dùng mask ước lượng.`);
        }
        return null;
    }
}

/** Mask AI cho một ảnh phôi: lấy từ DB nếu đã tách, chưa có thì gọi AI rồi lưu. */
async function aiMaskPng(imageUrl: string, imageBuf: Buffer): Promise<Buffer | null> {
    const key = sha1(imageUrl);
    const saved = await BlankMask.findOne({ key }).select('mask_png').lean().catch(() => null);
    if (saved?.mask_png) {
        // lean() có thể trả Buffer (khi đó .buffer là cả vùng nhớ chung) hoặc BSON Binary
        const v: any = saved.mask_png;
        return Buffer.isBuffer(v) ? v : Buffer.from(v.buffer ?? v);
    }

    if (!inflight.has(key)) {
        inflight.set(key, (async () => {
            const res = await segmentWithAi(imageBuf);
            if (!res) return null;
            await BlankMask.updateOne(
                { key },
                { $set: { key, image_url: imageUrl, mask_png: res.png, model: res.model, coverage: res.coverage } },
                { upsert: true },
            ).catch(err => logger.warn('[MOCKUP] Không lưu được mask: ' + err?.message));
            return res.png;
        })().finally(() => inflight.delete(key)));
    }
    return inflight.get(key)!;
}

// ---------- chuẩn bị ảnh phôi + mask (cache bộ nhớ) ----------

const MEM_MAX = 12;
const mem = new Map<string, { at: number; value: PreparedBase }>();
const HEURISTIC_TTL = 10 * 60_000; // mask ước lượng chỉ giữ ngắn, để lần sau AI chạy lại được

function memGet(key: string): PreparedBase | undefined {
    const hit = mem.get(key);
    if (!hit) return undefined;
    if (hit.value.source === 'heuristic' && Date.now() - hit.at > HEURISTIC_TTL) { mem.delete(key); return undefined; }
    mem.delete(key); mem.set(key, hit); // LRU
    return hit.value;
}
function memSet(key: string, value: PreparedBase) {
    mem.set(key, { at: Date.now(), value });
    while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value as string);
}

/**
 * Ảnh phôi (canvas 800×800) kèm mask phôi.
 * `load` đọc ảnh theo URL (truyền vào để dùng chung bộ nhớ đệm của một lượt render).
 */
export async function prepareBlankBase(
    imageUrl: string,
    area: AreaMaskInfo | null | undefined,
    load: (url: string) => Promise<Buffer>,
): Promise<PreparedBase> {
    const maskUrl = area?.mask_image && typeof area.mask_image === 'string' && area.mask_image.trim() ? area.mask_image.trim() : '';
    const memKey = `${imageUrl}|${maskUrl}|${area?.mask_status || ''}`;
    const cached = memGet(memKey);
    if (cached) return cached;

    const imageBuf = await load(imageUrl);
    const rgba = await toCanvasRgba(imageBuf);

    let mask: Uint8Array | null = null;
    let source: MaskSource = 'heuristic';

    if (maskUrl) {
        try {
            mask = await maskPngToCanvas(await load(maskUrl));
            source = area?.mask_status === 'custom' ? 'printer_custom'
                : area?.mask_status === 'confirmed' ? 'printer_confirmed' : 'printer_auto';
        } catch (err: any) {
            logger.warn(`[MOCKUP] Không đọc được mask xưởng khai báo (${err?.message}); tự tách lại.`);
        }
    }
    if (!mask) {
        // Ảnh phôi đã là PNG nền trong suốt thì alpha chính là mask chuẩn.
        const alpha = maskFromAlpha(rgba, CANVAS, CANVAS);
        if (alpha) { mask = alpha; source = 'printer_custom'; }
    }
    if (!mask) {
        const png = await aiMaskPng(imageUrl, imageBuf);
        if (png) {
            const m = await maskPngToCanvas(png);
            const cov = maskCoverage(m);
            if (cov > 0.02 && cov < 0.98) { mask = m; source = 'ai'; }
        }
    }
    if (!mask) {
        const m = heuristicMask(rgba, CANVAS, CANVAS);
        const cov = maskCoverage(m);
        // Loang tràn vào phôi (viền mờ) -> coi cả ảnh trừ mép là phôi còn hơn không đổi màu gì
        mask = cov > 0.02 ? m : new Uint8Array(CANVAS * CANVAS).fill(255);
        source = 'heuristic';
    }

    const value: PreparedBase = {
        rgba,
        mask: await softenMask(mask),
        source,
        key: sha1(`${memKey}|${source}|${sha1(imageBuf)}`),
    };
    memSet(memKey, value);
    return value;
}

/** Ảnh thật của một màu (xưởng chụp): không cần mask, chỉ cần canvas. */
export async function prepareColorPhoto(url: string, load: (url: string) => Promise<Buffer>): Promise<{ rgba: Uint8Array; key: string }> {
    const buf = await load(url);
    return { rgba: await toCanvasRgba(buf), key: sha1(`photo|${url}|${sha1(buf)}`) };
}

export function maskSourceLevel(source: MaskSource | 'photo'): 'photo' | 'verified' | 'auto' | 'estimated' {
    if (source === 'photo') return 'photo';
    if (source === 'printer_custom' || source === 'printer_confirmed') return 'verified';
    if (source === 'heuristic') return 'estimated';
    return 'auto';
}
