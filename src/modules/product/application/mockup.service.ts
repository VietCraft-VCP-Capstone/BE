import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { config } from '../../../app/config';
import { MOCKUP_DIR, UPLOAD_ROOT, publicUrl } from '../../../shared/upload/upload.middleware';
import { isCloudinaryEnabled, uploadImage } from '../../../infrastructure/storage/cloudinary.service';
import { logger } from '../../../shared/utils/logger';

export async function saveMockupResult(buffer: Buffer): Promise<string> {
    if (isCloudinaryEnabled()) {
        try {
            const asset = await uploadImage(buffer, { folder: 'mockups', mimetype: 'image/png' });
            return asset.url;
        } catch (err: any) {
            logger.warn(`Cloudinary upload failed for mockup (${err.message}), falling back to local.`);
        }
    }
    const outName = `${crypto.randomUUID()}.png`;
    const outAbs = path.join(MOCKUP_DIR, outName);
    await fs.promises.writeFile(outAbs, buffer);
    return publicUrl(outAbs);
}

export interface Placement {
    x: number;
    y: number;
    scale?: number;
    rotation?: number;
}
export interface PrintArea { key: string; x: number; y: number; width: number; height: number }

export async function loadImage(url: string): Promise<Buffer> {
    if (!url || typeof url !== 'string' || !url.trim()) {
        throw new Error('Đường dẫn ảnh phôi hoặc thiết kế không hợp lệ');
    }
    if (url.startsWith('/uploads/')) {
        const abs = path.join(UPLOAD_ROOT, url.replace('/uploads/', ''));
        if (fs.existsSync(abs)) {
            return sharp(abs).toBuffer();
        }
        const printerLocal = path.resolve(process.cwd(), '..', 'Printing-shop', 'Printing-shop', 'backend', url.replace(/^\//, ''));
        if (fs.existsSync(printerLocal)) {
            return sharp(printerLocal).toBuffer();
        }
    }
    if (url.startsWith('/images/')) {
        const localPath = path.resolve(process.cwd(), '..', 'frontend', 'public', url.replace(/^\//, ''));
        if (fs.existsSync(localPath)) {
            return sharp(localPath).toBuffer();
        }
    }
    const frontendOrigin = config.frontendUrl || 'http://localhost:3000';
    const printerOrigin = config.printerApiUrl || 'http://localhost:8880';
    const full = url.startsWith('http')
        ? url
        : (url.startsWith('/images/')
            ? `${frontendOrigin}${url}`
            : `${printerOrigin}${url}`);
    const res = await fetch(full);
    if (!res.ok) throw new Error(`Không tải được ảnh (${res.status}): ${full}`);
    return Buffer.from(await res.arrayBuffer());
}

export { COLOR_MAP, resolveColorHex, hexToRgb } from './mockup-color';

export async function generateMockup(
    blankImageUrl: string,
    designUrl: string,
    area: PrintArea | null,
    placement: Placement = { x: 0, y: 0 }
): Promise<string> {
    const [blankBuf, designBuf] = await Promise.all([loadImage(blankImageUrl), loadImage(designUrl)]);

    const blank = sharp(blankBuf).resize(800, 800, { fit: 'fill' });
    const canvasW = 800;
    const canvasH = 800;

    const box = area ?? { x: canvasW * 0.2, y: canvasH * 0.2, width: canvasW * 0.6, height: canvasH * 0.6, key: 'auto' };
    const targetW = Math.max(1, Math.round(box.width * (placement.scale ?? 1)));

    let design = sharp(designBuf).resize({ width: targetW, fit: 'inside' });
    if (placement.rotation) design = design.rotate(placement.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    const designPng = await design.png().toBuffer();
    const dMeta = await sharp(designPng).metadata();

    const left = Math.round(Math.max(0, Math.min(canvasW - (dMeta.width || 1), box.x + (placement.x || 0))));
    const top = Math.round(Math.max(0, Math.min(canvasH - (dMeta.height || 1), box.y + (placement.y || 0))));

    const pngBuf = await blank.composite([{ input: designPng, left, top }]).png().toBuffer();
    return saveMockupResult(pngBuf);
}

export interface Layer {
    type: 'image' | 'text' | 'shape';
    x: number; y: number; scale?: number; rotation?: number;
    flip_h?: boolean;

    designUrl?: string;

    text?: string; font_family?: string; font_size?: number; font_weight?: string; color?: string;

    shape?: string; fill?: string; stroke?: string; stroke_width?: number; width?: number; height?: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function shapeSvg(shape: string, w: number, h: number, fill: string, stroke: string, sw: number): string {
    const s = Math.max(0, sw);
    const inset = s / 2;
    const common = `fill="${fill}" stroke="${stroke}" stroke-width="${s}"`;
    let body = '';
    switch (shape) {
        case 'circle': body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - inset}" ry="${h / 2 - inset}" ${common}/>`; break;
        case 'triangle': body = `<polygon points="${w / 2},${inset} ${w - inset},${h - inset} ${inset},${h - inset}" ${common}/>`; break;
        case 'star': {
            const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - inset, r = R * 0.4; let pts = '';
            for (let i = 0; i < 10; i++) { const ang = -Math.PI / 2 + i * Math.PI / 5; const rad = i % 2 === 0 ? R : r; pts += `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)} `; }
            body = `<polygon points="${pts.trim()}" ${common}/>`; break;
        }
        case 'heart': {
            const sx = w / 32, sy = h / 32;
            body = `<path transform="scale(${sx},${sy})" d="M16 29 C16 29 2 20 2 11 C2 6 6 3 10 3 C13 3 15 5 16 7 C17 5 19 3 22 3 C26 3 30 6 30 11 C30 20 16 29 16 29 Z" ${common}/>`; break;
        }
        default: body = `<rect x="${inset}" y="${inset}" width="${w - s}" height="${h - s}" rx="${Math.min(w, h) * 0.04}" ${common}/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

/**
 * Lật/xoay một layer đã dựng đúng kích thước, khớp cách Konva hiển thị trong trình thiết kế:
 * Konva xoay quanh góc trên-trái (layer.x, layer.y) nên khung sau khi xoay lệch đi (dx, dy).
 * Lật/xoay tách pipeline riêng vì sharp luôn xoay trước khi resize nếu gộp chung một chuỗi.
 */
async function finishLayer(buf: Buffer, layer: Layer): Promise<{ buf: Buffer; w: number; h: number; dx: number; dy: number }> {
    const m0 = await sharp(buf).metadata();
    const w0 = m0.width || 1, h0 = m0.height || 1;
    let out = buf, dx = 0, dy = 0;
    if (layer.flip_h) out = await sharp(out).flop().png().toBuffer();
    if (layer.rotation) {
        out = await sharp(out).rotate(layer.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        const t = (layer.rotation * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
        dx = Math.min(0, w0 * c, -h0 * sn, w0 * c - h0 * sn);
        dy = Math.min(0, w0 * sn, h0 * c, w0 * sn + h0 * c);
    }
    const m = await sharp(out).metadata();
    return { buf: out, w: m.width || w0, h: m.height || h0, dx: Math.round(dx), dy: Math.round(dy) };
}

async function layerToPng(layer: Layer): Promise<{ buf: Buffer; w: number; h: number; dx: number; dy: number } | null> {
    const scale = layer.scale ?? 1;
    if (layer.type === 'image' && layer.designUrl) {
        const raw = await loadImage(layer.designUrl);
        const baseW = layer.width || (await sharp(raw).metadata()).width || 200;
        const sized = await sharp(raw).resize({ width: Math.max(1, Math.round(baseW * scale)), fit: 'inside' }).png().toBuffer();
        return finishLayer(sized, layer);
    }
    if (layer.type === 'shape') {
        const w = Math.max(1, Math.round((layer.width || 120) * scale));
        const h = Math.max(1, Math.round((layer.height || 120) * scale));
        const svg = shapeSvg(layer.shape || 'rect', w, h, layer.fill || '#7c3aed', layer.stroke || 'none', layer.stroke_width || 0);
        return finishLayer(await sharp(Buffer.from(svg)).png().toBuffer(), layer);
    }
    if (layer.type === 'text' && layer.text) {
        const fs = Math.max(6, Math.round((layer.font_size || 40) * scale));
        const font = layer.font_family || 'DejaVu Sans, Arial, sans-serif';
        const weight = layer.font_weight || 'bold';
        const color = layer.color || '#1a1a1a';
        // ước lượng bbox theo số ký tự (SVG không tự đo). pad rộng để không cắt chữ.
        const boxW = Math.max(1, Math.round(fs * 0.62 * layer.text.length + fs * 0.6));
        const boxH = Math.round(fs * 1.4);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${boxW}" height="${boxH}"><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="${esc(font)}" font-size="${fs}" font-weight="${weight}" fill="${color}">${esc(layer.text)}</text></svg>`;
        return finishLayer(await sharp(Buffer.from(svg)).png().toBuffer(), layer);
    }
    return null;
}

export interface WrapArea {
    x: number; y: number; width: number; height: number;
    template_w: number; template_h: number; arc?: number;
}

async function renderDieline(layers: Layer[], tW: number, tH: number): Promise<Buffer> {
    const base = sharp({ create: { width: tW, height: tH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } });
    const ops: { input: Buffer; left: number; top: number }[] = [];
    for (const layer of layers) {
        const rendered = await layerToPng(layer);
        if (!rendered) continue;
        const left = Math.round(Math.max(0, Math.min(tW - 1, layer.x + rendered.dx)));
        const top = Math.round(Math.max(0, Math.min(tH - 1, layer.y + rendered.dy)));
        ops.push({ input: rendered.buf, left, top });
    }
    return base.composite(ops).png().toBuffer();
}

async function cylinderWarp(flat: Buffer, boxW: number, boxH: number, arc: number): Promise<Buffer> {
    const STRIPS = 60;
    const meta = await sharp(flat).metadata();
    const fW = meta.width || boxW, fH = meta.height || boxH;
    const half = arc / 2;
    const sxOf = (u: number) => (Math.sin(-half + u * arc) / Math.sin(half) + 1) / 2;

    const strips: { input: Buffer; left: number; top: number }[] = [];
    for (let i = 0; i < STRIPS; i++) {
        const u0 = i / STRIPS, u1 = (i + 1) / STRIPS;
        const left = Math.round(sxOf(u0) * boxW);
        const right = Math.round(sxOf(u1) * boxW);
        const w = Math.max(1, right - left + 1);
        const thetaMid = -half + ((u0 + u1) / 2) * arc;
        const scaleH = 0.80 + 0.20 * Math.cos(thetaMid);
        const h = Math.max(1, Math.round(boxH * scaleH));
        const top = Math.round((boxH - h) / 2);
        const cropLeft = Math.min(Math.round(u0 * fW), fW - 1);
        const cropW = Math.max(1, Math.round((u1 - u0) * fW));

        const safeW = Math.min(w, Math.max(1, boxW - left));
        const safeH = Math.min(h, Math.max(1, boxH - top));
        if (safeW <= 0 || safeH <= 0 || left >= boxW || top >= boxH) continue;

        const stripBuf = await sharp(flat)
            .extract({ left: cropLeft, top: 0, width: Math.min(cropW, fW - cropLeft), height: fH })
            .resize(safeW, safeH, { fit: 'fill' })
            .png().toBuffer();
        strips.push({ input: stripBuf, left, top });
    }
    return sharp({ create: { width: boxW, height: boxH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(strips).png().toBuffer();
}

export async function generateFlatDieline(layers: Layer[], tW: number, tH: number): Promise<string> {
    const buf = await renderDieline(layers, tW, tH);
    const pngBuf = await sharp({ create: { width: tW, height: tH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
        .composite([{ input: buf, left: 0, top: 0 }]).png().toBuffer();
    return saveMockupResult(pngBuf);
}

// ---------- Pipeline mới: thiết kế dựng 1 lần, ghép lên từng màu phôi ----------

const CANVAS_SIZE = 800;

/**
 * Lớp thiết kế trong suốt kích thước canvas (800×800), không phụ thuộc màu phôi.
 * flat: đặt layer theo toạ độ canvas. wrap: dựng tấm phẳng trong vùng in rồi uốn cong quanh thân ly.
 */
export async function renderDesignOverlay(
    layers: Layer[],
    surface: 'flat' | 'wrap',
    wrapArea?: WrapArea,
): Promise<Buffer> {
    const canvas = () => sharp({ create: { width: CANVAS_SIZE, height: CANVAS_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });

    if (surface === 'wrap' && wrapArea) {
        let boxW = Math.round(wrapArea.width || 440);
        let boxH = Math.round(wrapArea.height || 340);
        if (boxW >= CANVAS_SIZE || boxH >= CANVAS_SIZE || boxW <= 50 || boxH <= 50) { boxW = 440; boxH = 340; }
        let left = Math.round(wrapArea.x ?? 180);
        let top = Math.round(wrapArea.y ?? 220);
        if (left >= CANVAS_SIZE || left < 0) left = 180;
        if (top >= CANVAS_SIZE || top < 0) top = 220;
        left = Math.min(left, CANVAS_SIZE - boxW);
        top = Math.min(top, CANVAS_SIZE - boxH);

        const ops: { input: Buffer; left: number; top: number }[] = [];
        for (const layer of layers) {
            const r = await layerToPng(layer);
            if (!r) continue;
            let buf = r.buf, w = r.w, h = r.h;
            if (w > boxW || h > boxH) {
                buf = await sharp(buf).resize(Math.min(w, boxW), Math.min(h, boxH), { fit: 'inside' }).png().toBuffer();
                const m = await sharp(buf).metadata(); w = m.width || w; h = m.height || h;
            }
            ops.push({
                input: buf,
                left: Math.max(0, Math.min(boxW - w, Math.round(layer.x + r.dx - left))),
                top: Math.max(0, Math.min(boxH - h, Math.round(layer.y + r.dy - top))),
            });
        }
        const flatBase = sharp({ create: { width: boxW, height: boxH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
        const flat = await (ops.length ? flatBase.composite(ops) : flatBase).png().toBuffer();
        const warped = await cylinderWarp(flat, boxW, boxH, wrapArea.arc || 1.35);
        return canvas().composite([{ input: warped, left, top }]).png().toBuffer();
    }

    const ops: { input: Buffer; left: number; top: number }[] = [];
    for (const layer of layers) {
        const r = await layerToPng(layer);
        if (!r) continue;
        let buf = r.buf, w = r.w, h = r.h;
        if (w > CANVAS_SIZE || h > CANVAS_SIZE) {
            buf = await sharp(buf).resize(Math.min(w, CANVAS_SIZE), Math.min(h, CANVAS_SIZE), { fit: 'inside' }).png().toBuffer();
            const m = await sharp(buf).metadata(); w = m.width || w; h = m.height || h;
        }
        ops.push({
            input: buf,
            left: Math.round(Math.max(0, Math.min(CANVAS_SIZE - w, layer.x + r.dx))),
            top: Math.round(Math.max(0, Math.min(CANVAS_SIZE - h, layer.y + r.dy))),
        });
    }
    return (ops.length ? canvas().composite(ops) : canvas()).png().toBuffer();
}

/**
 * Ghép lớp thiết kế lên ảnh phôi (đã đổi màu) rồi phủ bản đồ bóng (multiply) chỉ trong vùng có
 * thiết kế, để hình in chìm theo nếp vải / độ cong thay vì nổi phẳng lên trên.
 */
export async function composeMockup(baseRgba: Uint8Array, overlayPng: Buffer, shading: Uint8Array): Promise<Buffer> {
    const n = CANVAS_SIZE * CANVAS_SIZE;
    const alphaRaw = await sharp(overlayPng).ensureAlpha().extractChannel(3).raw().toBuffer();
    const shade = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) {
        const o = i * 4, v = shading[i];
        shade[o] = v; shade[o + 1] = v; shade[o + 2] = v; shade[o + 3] = alphaRaw[i];
    }
    const raw = { width: CANVAS_SIZE, height: CANVAS_SIZE, channels: 4 as const };
    // Ghép 2 bước: ghép thiết kế trước, rồi multiply bóng lên kết quả đó.
    const withDesign = await sharp(Buffer.from(baseRgba.buffer, baseRgba.byteOffset, baseRgba.length), { raw })
        .composite([{ input: overlayPng }])
        .raw().toBuffer();
    return sharp(withDesign, { raw })
        .composite([{ input: shade, raw, blend: 'multiply' }])
        .png().toBuffer();
}
