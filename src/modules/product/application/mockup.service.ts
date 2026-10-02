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
    if (url.startsWith('/uploads/')) {
        const abs = path.join(UPLOAD_ROOT, url.replace('/uploads/', ''));
        return sharp(abs).toBuffer();
    }
    if (url.startsWith('/images/')) {
        const localPath = path.join(process.cwd(), '..', 'FE', 'public', url);
        if (fs.existsSync(localPath)) {
            return sharp(localPath).toBuffer();
        }
    }
    const frontendOrigin = config.frontendUrl || 'http://localhost:3000';
    const full = url.startsWith('http') ? url : (url.startsWith('/') ? `${frontendOrigin}${url}` : `${config.printerApiUrl}${url}`);
    const res = await fetch(full);
    if (!res.ok) throw new Error(`Không tải được ảnh phôi (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
}


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

export async function generateMockupLayers(blankImageUrl: string, layers: Layer[]): Promise<string> {
    const blankBuf = await loadImage(blankImageUrl);
    const canvasW = 800, canvasH = 800;
    const blank = sharp(blankBuf).resize(canvasW, canvasH, { fit: 'fill' });

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

export async function generateWrapMockup(blankImageUrl: string, layers: Layer[], area: WrapArea): Promise<string> {
    const blankBuf = await loadImage(blankImageUrl);
    const canvasW = 800, canvasH = 800;
    const blank = sharp(blankBuf).resize(canvasW, canvasH, { fit: 'fill' });

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
