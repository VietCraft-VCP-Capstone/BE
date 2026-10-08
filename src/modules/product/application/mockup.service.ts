import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { config } from '../../../app/config';
import { MOCKUP_DIR, UPLOAD_ROOT, publicUrl } from '../../../shared/upload/upload.middleware';
import { isCloudinaryEnabled, uploadImage } from '../../../infrastructure/storage/cloudinary.service';
import { logger } from '../../../shared/utils/logger';

async function saveMockupResult(buffer: Buffer): Promise<string> {
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

async function loadImage(url: string): Promise<Buffer> {
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

export function resolveColorHex(colorName?: string, hex?: string): string | undefined {
    if (hex && typeof hex === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim())) {
        return hex.trim();
    }
    if (!colorName || typeof colorName !== 'string') return undefined;
    const lower = colorName.trim().toLowerCase();
    return COLOR_MAP[lower] || undefined;
}

export function isLightOrWhite(colorHex: string): boolean {
    const hex = colorHex.replace('#', '').trim().toLowerCase();
    if (hex === 'fff' || hex === 'ffffff') return true;
    if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        if (r > 242 && g > 242 && b > 242) return true;
    }
    return false;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const clean = hex.replace('#', '').trim();
    if (clean.length === 3) {
        return {
            r: parseInt(clean[0] + clean[0], 16),
            g: parseInt(clean[1] + clean[1], 16),
            b: parseInt(clean[2] + clean[2], 16)
        };
    }
    return {
        r: parseInt(clean.slice(0, 2), 16),
        g: parseInt(clean.slice(2, 4), 16),
        b: parseInt(clean.slice(4, 6), 16)
    };
}

/**
 * Áp màu chỉ lên phần sản phẩm, GIỮ NGUYÊN background:
 *
 * Thuật toán:
 *  1. Lấy mẫu màu background từ 8 điểm góc/cạnh ảnh
 *  2. Với mỗi pixel:
 *     - Nếu gần màu background (distance < threshold) → giữ nguyên
 *     - Nếu là pixel sản phẩm → áp Multiply blend (base × color / 255)
 *
 * Kết quả: áo trắng × màu = màu đó; bóng/nếp gấp × màu = tối tự nhiên;
 *           background không thay đổi.
 */
export async function applyBlankColor(blankSharp: any, colorHex?: string): Promise<any> {
    if (!colorHex || typeof colorHex !== 'string') return blankSharp;
    const cleanHex = colorHex.trim();
    if (isLightOrWhite(cleanHex)) return blankSharp; // Trắng/kem: giữ nguyên
    try {
        const sourceBuf: Buffer = await blankSharp.png().toBuffer();
        const meta = await sharp(sourceBuf).metadata();
        const W = meta.width || 800;
        const H = meta.height || 800;
        const CH = 4; // RGBA channels

        const { r: tR, g: tG, b: tB } = hexToRgb(cleanHex);

        // Lấy raw pixels RGBA
        const rawBuf = await sharp(sourceBuf).ensureAlpha().raw().toBuffer();

        // --- Phát hiện màu background từ 8 điểm cạnh/góc ---
        const sampleAt = (x: number, y: number): [number, number, number] => {
            const idx = (y * W + x) * CH;
            return [rawBuf[idx], rawBuf[idx + 1], rawBuf[idx + 2]];
        };
        const edgeSamples = [
            sampleAt(0, 0), sampleAt(W - 1, 0),
            sampleAt(0, H - 1), sampleAt(W - 1, H - 1),
            sampleAt(Math.floor(W / 2), 0),
            sampleAt(Math.floor(W / 2), H - 1),
            sampleAt(0, Math.floor(H / 2)),
            sampleAt(W - 1, Math.floor(H / 2)),
        ];
        const bgR = Math.round(edgeSamples.reduce((s, c) => s + c[0], 0) / edgeSamples.length);
        const bgG = Math.round(edgeSamples.reduce((s, c) => s + c[1], 0) / edgeSamples.length);
        const bgB = Math.round(edgeSamples.reduce((s, c) => s + c[2], 0) / edgeSamples.length);

        // Ngưỡng khoảng cách màu để nhận diện background
        // 45 = chấp nhận sai lệch nhỏ do JPEG compression, anti-aliasing
        const BG_THRESHOLD = 45;

        // --- Xử lý từng pixel ---
        const resultBuf = Buffer.alloc(W * H * CH);
        for (let i = 0; i < W * H; i++) {
            const idx = i * CH;
            const pR = rawBuf[idx];
            const pG = rawBuf[idx + 1];
            const pB = rawBuf[idx + 2];
            const pA = rawBuf[idx + 3];

            // Khoảng cách Euclidean từ màu background
            const distBg = Math.sqrt(
                (pR - bgR) ** 2 +
                (pG - bgG) ** 2 +
                (pB - bgB) ** 2
            );

            if (distBg < BG_THRESHOLD) {
                // Pixel background → giữ nguyên
                resultBuf[idx]     = pR;
                resultBuf[idx + 1] = pG;
                resultBuf[idx + 2] = pB;
            } else {
                // Pixel sản phẩm → Multiply blend để đổi màu
                // Trắng (255) × màu target = màu target ✓
                // Xám (bóng/gấp) × màu target = tối tự nhiên ✓
                resultBuf[idx]     = Math.round((pR * tR) / 255);
                resultBuf[idx + 1] = Math.round((pG * tG) / 255);
                resultBuf[idx + 2] = Math.round((pB * tB) / 255);
            }
            resultBuf[idx + 3] = pA; // Alpha không đổi
        }

        const coloredBuf = await sharp(resultBuf, { raw: { width: W, height: H, channels: CH } })
            .png()
            .toBuffer();

        return sharp(coloredBuf);
    } catch {
        return blankSharp; // Fallback về ảnh gốc nếu lỗi
    }
}

export async function generateMockup(
    blankImageUrl: string,
    designUrl: string,
    area: PrintArea | null,
    placement: Placement = { x: 0, y: 0 },
    colorHex?: string
): Promise<string> {
    const [blankBuf, designBuf] = await Promise.all([loadImage(blankImageUrl), loadImage(designUrl)]);

    let blank = sharp(blankBuf).resize(800, 800, { fit: 'fill' });
    blank = await applyBlankColor(blank, colorHex);
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

async function layerToPng(layer: Layer): Promise<{ buf: Buffer; w: number; h: number } | null> {
    const scale = layer.scale ?? 1;
    if (layer.type === 'image' && layer.designUrl) {
        const raw = await loadImage(layer.designUrl);
        const baseW = layer.width || (await sharp(raw).metadata()).width || 200;
        let img = sharp(raw).resize({ width: Math.max(1, Math.round(baseW * scale)), fit: 'inside' });
        if (layer.rotation) img = img.rotate(layer.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
        const buf = await img.png().toBuffer(); const m = await sharp(buf).metadata();
        return { buf, w: m.width || 1, h: m.height || 1 };
    }
    if (layer.type === 'shape') {
        const w = Math.max(1, Math.round((layer.width || 120) * scale));
        const h = Math.max(1, Math.round((layer.height || 120) * scale));
        const svg = shapeSvg(layer.shape || 'rect', w, h, layer.fill || '#7c3aed', layer.stroke || 'none', layer.stroke_width || 0);
        let img = sharp(Buffer.from(svg));
        if (layer.rotation) img = img.rotate(layer.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
        const buf = await img.png().toBuffer(); const m = await sharp(buf).metadata();
        return { buf, w: m.width || w, h: m.height || h };
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
        let img = sharp(Buffer.from(svg));
        if (layer.rotation) img = img.rotate(layer.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
        const buf = await img.png().toBuffer(); const m = await sharp(buf).metadata();
        return { buf, w: m.width || boxW, h: m.height || boxH };
    }
    return null;
}

export async function generateMockupLayers(blankImageUrl: string, layers: Layer[], colorHex?: string): Promise<string> {
    const blankBuf = await loadImage(blankImageUrl);
    const canvasW = 800, canvasH = 800;
    let blank = sharp(blankBuf).resize(canvasW, canvasH, { fit: 'fill' });
    blank = await applyBlankColor(blank, colorHex);

    const ops: { input: Buffer; left: number; top: number }[] = [];
    for (const layer of layers) {
        const rendered = await layerToPng(layer);
        if (!rendered) continue;

        let finalBuf = rendered.buf;
        let rW = rendered.w;
        let rH = rendered.h;

        // Đảm bảo kích thước overlay không vượt quá khung canvas 800x800
        if (rW > canvasW || rH > canvasH) {
            const fitW = Math.min(rW, canvasW);
            const fitH = Math.min(rH, canvasH);
            finalBuf = await sharp(finalBuf).resize(fitW, fitH, { fit: 'inside' }).png().toBuffer();
            const meta = await sharp(finalBuf).metadata();
            rW = meta.width || fitW;
            rH = meta.height || fitH;
        }

        const left = Math.round(Math.max(0, Math.min(canvasW - rW, layer.x)));
        const top = Math.round(Math.max(0, Math.min(canvasH - rH, layer.y)));
        ops.push({ input: finalBuf, left, top });
    }
    const pngBuf = await blank.composite(ops).png().toBuffer();
    return saveMockupResult(pngBuf);
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
        const left = Math.round(Math.max(0, Math.min(tW - 1, layer.x)));
        const top = Math.round(Math.max(0, Math.min(tH - 1, layer.y)));
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

export async function generateWrapMockup(blankImageUrl: string, layers: Layer[], area: WrapArea, colorHex?: string): Promise<string> {
    const blankBuf = await loadImage(blankImageUrl);
    const canvasW = 800, canvasH = 800;
    let blank = sharp(blankBuf).resize(canvasW, canvasH, { fit: 'fill' });
    blank = await applyBlankColor(blank, colorHex);

    // Kích thước và toạ độ vùng in trên ảnh mockup ly (canvas 800x800)
    let boxW = Math.round(area.width || 440);
    let boxH = Math.round(area.height || 340);
    if (boxW >= canvasW || boxH >= canvasH || boxW <= 50 || boxH <= 50) {
        boxW = 440;
        boxH = 340;
    }

    let left = Math.round(area.x ?? 180);
    let top = Math.round(area.y ?? 220);
    if (left >= canvasW || left < 0) left = 180;
    if (top >= canvasH || top < 0) top = 220;
    left = Math.min(left, canvasW - boxW);
    top = Math.min(top, canvasH - boxH);

    // Tạo tấm phẳng 2D chứa các layer thiết kế đúng toạ độ tương đối bên trong vùng in
    const flatBase = sharp({
        create: {
            width: boxW,
            height: boxH,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    });

    const ops: { input: Buffer; left: number; top: number }[] = [];
    for (const layer of layers) {
        const rendered = await layerToPng(layer);
        if (!rendered) continue;

        let finalBuf = rendered.buf;
        let rW = rendered.w;
        let rH = rendered.h;

        // Đảm bảo kích thước overlay không vượt quá khung vùng in
        if (rW > boxW || rH > boxH) {
            const fitW = Math.min(rW, boxW);
            const fitH = Math.min(rH, boxH);
            finalBuf = await sharp(finalBuf).resize(fitW, fitH, { fit: 'inside' }).png().toBuffer();
            const meta = await sharp(finalBuf).metadata();
            rW = meta.width || fitW;
            rH = meta.height || fitH;
        }

        // Toạ độ tương đối của layer bên trong vùng in (area)
        const relX = Math.round(layer.x - left);
        const relY = Math.round(layer.y - top);
        const layerLeft = Math.max(0, Math.min(boxW - rW, relX));
        const layerTop = Math.max(0, Math.min(boxH - rH, relY));

        ops.push({ input: finalBuf, left: layerLeft, top: layerTop });
    }

    const flat = ops.length
        ? await flatBase.composite(ops).png().toBuffer()
        : await flatBase.png().toBuffer();

    // Uốn cong 3D (Cylinder Warp) tấm phẳng ôm tròn quanh thân ly
    const arc = area.arc || 1.35;
    const warped = await cylinderWarp(flat, boxW, boxH, arc);

    const pngBuf = await blank
        .composite([{ input: warped, left, top }])
        .png().toBuffer();
    return saveMockupResult(pngBuf);
}

export async function generateFlatDieline(layers: Layer[], tW: number, tH: number): Promise<string> {
    const buf = await renderDieline(layers, tW, tH);
    const pngBuf = await sharp({ create: { width: tW, height: tH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
        .composite([{ input: buf, left: 0, top: 0 }]).png().toBuffer();
    return saveMockupResult(pngBuf);
}
