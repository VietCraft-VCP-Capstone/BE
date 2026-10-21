import { PreviewBodyResult } from './health-preview';
import { normalizeMaterials } from '../../../shared/utils/materials';

const UPLOAD_PATH = /^\/([^/]+)\/image\/upload\/./;

function imageUrlAllowed(url: string): boolean {
    if (url.length > 2048) return false;
    let u: URL, plain: string;
    try { u = new URL(url); plain = decodeURIComponent(u.pathname); } catch { return false; }
    const cloud = process.env.CLOUDINARY_CLOUD_NAME;
    const m = UPLOAD_PATH.exec(u.pathname);
    return u.href === url && u.protocol === 'https:' && u.host === 'res.cloudinary.com' && !u.username && !u.password
        && !/%2e|%2f|%5c/i.test(u.pathname) && !/\.\.|\\|fetch:/i.test(plain)
        && m !== null && (!cloud || m[1] === cloud);
}

type Body = Record<string, unknown>;

function strings(value: unknown, max: number, ok: (s: string) => boolean): string[] | null {
    if (!Array.isArray(value) || value.length > max) return null;
    return value.every(v => typeof v === 'string' && ok(v)) ? (value as string[]) : null;
}

function text(value: unknown, max: number): string | null {
    return typeof value === 'string' && value.length <= max ? value : null;
}

export function parseIntelPreview(raw: unknown): PreviewBodyResult<Body> {
    const src = raw && typeof raw === 'object' ? (raw as Body) : {};
    const body: Body = {};

    const title = typeof src.title === 'string' ? src.title.trim() : '';
    if (title.length < 1 || title.length > 200) return { invalid: 'title' };
    body.title = title;

    for (const [key, max] of [['description', 5000], ['category', 80]] as const) {
        if (src[key] == null) continue;
        const value = text(src[key], max);
        if (value === null) return { invalid: key };
        body[key] = value;
    }

    if (src.price != null) {
        const price = src.price;
        if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 1e9) return { invalid: 'price' };
        body.price = price;
    }

    const lists = [
        ['tags', 20, (s: string) => s.trim().length >= 1 && s.trim().length <= 40],
        ['image_urls', 8, imageUrlAllowed],
    ] as const;
    for (const [key, max, ok] of lists) {
        if (src[key] == null) continue;
        const value = strings(src[key], max, ok);
        if (!value) return { invalid: key };
        body[key] = key === 'tags' ? value.map(s => s.trim()) : value;
    }

    if (src.materials != null) {
        if (!Array.isArray(src.materials)) return { invalid: 'materials' };
        body.materials = normalizeMaterials(src.materials);
    }
    return { body };
}
