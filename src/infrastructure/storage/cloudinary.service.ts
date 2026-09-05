import crypto from 'crypto';
import { config } from '../../app/config';


export interface CloudinaryAsset {
    url: string;
    publicId: string;
    width?: number;
    height?: number;
}

const cfg = () => config.cloudinary;

export function isCloudinaryEnabled(): boolean {
    const c = cfg();
    return Boolean(c.cloudName) && (Boolean(c.uploadPreset) || (Boolean(c.apiKey) && Boolean(c.apiSecret)));
}

function sign(params: Record<string, string>, apiSecret: string): string {
    const payload = Object.keys(params)
        .sort()
        .map(k => `${k}=${params[k]}`)
        .join('&');
    return crypto.createHash('sha1').update(payload + apiSecret).digest('hex');
}


export async function uploadImage(
    buffer: Buffer,
    opts: { folder?: string; filename?: string; mimetype?: string } = {}
): Promise<CloudinaryAsset> {
    const c = cfg();
    if (!isCloudinaryEnabled()) throw new Error('Cloudinary chưa được cấu hình.');

    const folder = opts.folder || c.folder;
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: opts.mimetype || 'image/png' }), opts.filename || 'upload');
    if (folder) form.append('folder', folder);

    if (c.apiKey && c.apiSecret) {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const signed: Record<string, string> = { timestamp };
        if (folder) signed.folder = folder;
        form.append('timestamp', timestamp);
        form.append('api_key', c.apiKey);
        form.append('signature', sign(signed, c.apiSecret));
    } else {
        form.append('upload_preset', c.uploadPreset);
    }

    let res: Response;
    try {
        res = await fetch(`${c.apiBase}/v1_1/${c.cloudName}/image/upload`, {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(20000),
        });
    } catch (err: any) {
        throw new Error(`Không kết nối được Cloudinary: ${err.message}`);
    }

    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`Cloudinary từ chối upload: ${data?.error?.message || res.status}`);
    }
    if (!data.secure_url || !data.public_id) {
        throw new Error('Cloudinary trả về dữ liệu không hợp lệ.');
    }

    return { url: data.secure_url, publicId: data.public_id, width: data.width, height: data.height };
}

export default { isCloudinaryEnabled, uploadImage };
