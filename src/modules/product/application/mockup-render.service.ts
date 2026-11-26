import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { UPLOAD_ROOT } from '../../../shared/upload/upload.middleware';
import { logger } from '../../../shared/utils/logger';
import { MockupRender } from '../infrastructure/models/mockup-cache.model';
import { MaskSource, maskSourceLevel, prepareBlankBase, prepareColorPhoto } from './blank-mask.service';
import { Box, recolorInMask, resolveColorHex, shadingMap } from './mockup-color';
import { composeMockup, Layer, loadImage, renderDesignOverlay, saveMockupResult, WrapArea } from './mockup.service';

export type ImageLevel = 'photo' | 'verified' | 'auto' | 'estimated';

export interface RenderPlacement {
    areaKey: string;
    label?: string;
    baseImage: string;
    maskImage?: string;
    maskStatus?: string;
    surface: 'flat' | 'wrap';
    box: Box;
    wrap?: WrapArea;
    layers: Layer[];
}

export interface RenderColor {
    color: string;
    hex?: string;
    /** Ảnh thật xưởng chụp cho màu này, theo mặt in. */
    photoByArea?: Record<string, string>;
}

export interface RenderedImage {
    url: string;
    area_key: string;
    source: MaskSource | 'photo' | 'none';
    level: ImageLevel;
}

export interface RenderedColor {
    color: string;
    color_hex?: string;
    images: RenderedImage[];
}

const sha1 = (s: string | Buffer) => crypto.createHash('sha1').update(s).digest('hex');

/** Chạy tối đa `limit` việc song song, giữ thứ tự kết quả. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

function cachedUrlStillValid(url: string): boolean {
    if (!url.startsWith('/uploads/')) return true;
    return fs.existsSync(path.join(UPLOAD_ROOT, url.replace('/uploads/', '')));
}

async function fromCache(key: string): Promise<{ url: string; source: string } | null> {
    const hit = await MockupRender.findOne({ key }).lean().catch(() => null);
    return hit && cachedUrlStillValid(hit.url) ? { url: hit.url, source: hit.source } : null;
}

async function toCache(key: string, url: string, source: string) {
    await MockupRender.updateOne({ key }, { $set: { key, url, source, created_at: new Date() } }, { upsert: true })
        .catch(err => logger.warn('[MOCKUP] Không lưu được cache render: ' + err?.message));
}

/**
 * Render mockup cho từng màu × từng mặt in.
 *  - Lớp thiết kế và mask phôi tính 1 lần cho mỗi mặt, dùng chung cho mọi màu.
 *  - Màu có ảnh thật của xưởng -> ghép lên ảnh thật; không có -> đổi màu trong mask.
 *  - Ảnh đã render được cache theo nội dung, quay lại bước xem trước không render lại.
 */
export async function renderColorMockups(placements: RenderPlacement[], colors: RenderColor[]): Promise<RenderedColor[]> {
    const files = new Map<string, Promise<Buffer>>();
    const load = (url: string) => {
        if (!files.has(url)) files.set(url, loadImage(url).catch(err => { files.delete(url); throw err; }));
        return files.get(url)!;
    };

    // Chuẩn bị theo mặt in (độc lập với màu)
    const prepared = await Promise.all(placements.map(async p => {
        const overlay = await renderDesignOverlay(p.layers, p.surface, p.wrap);
        const base = await prepareBlankBase(p.baseImage, { mask_image: p.maskImage, mask_status: p.maskStatus }, load);
        return {
            p,
            overlay,
            overlayKey: sha1(overlay),
            base,
            baseShading: shadingMap(base.rgba, base.mask, p.box),
        };
    }));

    const list = colors.length ? colors : [{ color: 'Mặc định' } as RenderColor];
    return mapLimit(list, 3, async (c): Promise<RenderedColor> => {
        const hex = resolveColorHex(c.color, c.hex);
        const images: RenderedImage[] = [];
        for (const pr of prepared) {
            const photoUrl = c.photoByArea?.[pr.p.areaKey];
            try {
                if (photoUrl) {
                    const photo = await prepareColorPhoto(photoUrl, load);
                    const key = sha1(`v2|photo|${photo.key}|${pr.overlayKey}`);
                    const hit = await fromCache(key);
                    const url = hit?.url ?? await (async () => {
                        const png = await composeMockup(photo.rgba, pr.overlay, shadingMap(photo.rgba, null, pr.p.box));
                        const u = await saveMockupResult(png);
                        await toCache(key, u, 'photo');
                        return u;
                    })();
                    images.push({ url, area_key: pr.p.areaKey, source: 'photo', level: 'photo' });
                    continue;
                }
                const key = sha1(`v2|mask|${pr.base.key}|${hex || 'none'}|${pr.overlayKey}`);
                const hit = await fromCache(key);
                const url = hit?.url ?? await (async () => {
                    const rgba = hex ? recolorInMask(pr.base.rgba, pr.base.mask, hex) : pr.base.rgba;
                    const png = await composeMockup(rgba, pr.overlay, pr.baseShading);
                    const u = await saveMockupResult(png);
                    await toCache(key, u, pr.base.source);
                    return u;
                })();
                // Không có mã màu (tên lạ, xưởng không nhập hex) -> ảnh chưa được đổi màu, không được coi là chuẩn
                const noColor = !hex && list.length > 1;
                images.push({
                    url, area_key: pr.p.areaKey,
                    source: noColor ? 'none' : pr.base.source,
                    level: noColor ? 'estimated' : maskSourceLevel(pr.base.source),
                });
            } catch (err: any) {
                logger.warn(`[MOCKUP] Render lỗi màu "${c.color}" mặt ${pr.p.areaKey}: ${err?.message || err}`);
            }
        }
        return { color: c.color, color_hex: hex, images };
    });
}
