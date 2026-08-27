import crypto from 'crypto';
import { config } from '../../app/config';

/**
 * Upload ảnh lên Cloudinary. Đi qua BE (không phải browser) để giữ được
 * authenticate/requireRole và bước validate bằng sharp trước khi ảnh rời máy chủ.
 *
 * Hai chế độ, tự chọn theo credential có trong env:
 *  - signed   (api_key + api_secret): ký tham số bằng SHA-1, không lộ gì ra client.
 *  - unsigned (upload_preset):        preset phải để chế độ Unsigned trên dashboard.
 *
 * Chưa cấu hình gì -> isEnabled() = false, caller tự fallback về đĩa local.
 * ponytail: dùng fetch + FormData global (Node 18+), không kéo thêm SDK cloudinary.
 */

export interface CloudinaryAsset {
    /** URL https công khai — lưu thẳng vào Design.file_url. */
    url: string;
    /** Định danh asset trên Cloudinary, giữ lại để sau này xoá/transform. */
    publicId: string;
    width?: number;
    height?: number;
}

const cfg = () => config.cloudinary;

/** Có đủ credential để upload không. Thiếu -> caller dùng đĩa local. */
export function isCloudinaryEnabled(): boolean {
    const c = cfg();
    return Boolean(c.cloudName) && (Boolean(c.uploadPreset) || (Boolean(c.apiKey) && Boolean(c.apiSecret)));
}

/** Chữ ký signed upload: sort key, nối k=v bằng &, SHA-1 với api_secret ở cuối. */
function sign(params: Record<string, string>, apiSecret: string): string {
    const payload = Object.keys(params)
        .sort()
        .map(k => `${k}=${params[k]}`)
        .join('&');
    return crypto.createHash('sha1').update(payload + apiSecret).digest('hex');
}

/**
 * Đẩy 1 buffer ảnh lên Cloudinary, trả về URL https + public_id.
 * Ném lỗi kèm message của Cloudinary để router trả 400 có nội dung thật.
 */
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
        // Signed: timestamp phải là giây, và mọi tham số ký phải khớp tuyệt đối với form.
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
            // Không để request seller treo vô hạn khi Cloudinary chậm.
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
