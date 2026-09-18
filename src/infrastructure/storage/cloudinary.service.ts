import { v2 as cloudinary, UploadApiResponse, UploadApiOptions } from 'cloudinary';
import { Readable } from 'stream';
import { config } from '../../app/config';
import { logger } from '../../shared/utils/logger';

export interface CloudinaryAsset {
    url: string;
    publicId: string;
    width?: number;
    height?: number;
    format?: string;
    bytes?: number;
}

export interface UploadImageOptions {
    folder?: string;
    filename?: string;
    mimetype?: string;
    transformation?: any[];
    tags?: string[];
}

const cfg = () => config.cloudinary;

let isConfigured = false;

function ensureConfigured(): boolean {
    const c = cfg();
    if (isConfigured) return true;

    if (c.url) {
        cloudinary.config({ cloudinary_url: c.url, secure: true });
        isConfigured = true;
        return true;
    }

    if (c.cloudName && c.apiKey && c.apiSecret) {
        cloudinary.config({
            cloud_name: c.cloudName,
            api_key: c.apiKey,
            api_secret: c.apiSecret,
            secure: true,
        });
        isConfigured = true;
        return true;
    }

    return false;
}

export function isCloudinaryEnabled(): boolean {
    const c = cfg();
    return Boolean(c.url) || (Boolean(c.cloudName) && ((Boolean(c.apiKey) && Boolean(c.apiSecret)) || Boolean(c.uploadPreset)));
}

/**
 * Tải ảnh lên Cloudinary từ Buffer hoặc Đường dẫn File (Path).
 * Tự động áp dụng tối ưu hóa định dạng (f_auto) và chất lượng (q_auto).
 */
export async function uploadImage(
    source: Buffer | string,
    opts: UploadImageOptions = {}
): Promise<CloudinaryAsset> {
    if (!isCloudinaryEnabled()) {
        throw new Error('Cloudinary chưa được cấu hình.');
    }

    ensureConfigured();
    const c = cfg();

    const folderName = opts.folder
        ? (opts.folder.startsWith('vietcraft') ? opts.folder : `vietcraft/${opts.folder}`)
        : (c.folder || 'vietcraft/general');

    const uploadOptions: UploadApiOptions = {
        folder: folderName,
        resource_type: 'image',
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        tags: opts.tags || ['vietcraft'],
    };

    if (opts.transformation && opts.transformation.length > 0) {
        uploadOptions.transformation = opts.transformation;
    }

    // Nếu cấu hình dùng upload_preset unsigned
    if (!c.apiSecret && c.uploadPreset) {
        uploadOptions.upload_preset = c.uploadPreset;
    }

    // Trường hợp source là Buffer (thường dùng qua multer memoryStorage)
    if (Buffer.isBuffer(source)) {
        return new Promise<CloudinaryAsset>((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                uploadOptions,
                (error, result: UploadApiResponse | undefined) => {
                    if (error || !result) {
                        logger.error('Cloudinary upload stream error: ' + (error?.message || 'Không có phản hồi'));
                        return reject(new Error(`Cloudinary từ chối upload: ${error?.message || 'Lỗi không xác định'}`));
                    }
                    resolve({
                        url: result.secure_url,
                        publicId: result.public_id,
                        width: result.width,
                        height: result.height,
                        format: result.format,
                        bytes: result.bytes,
                    });
                }
            );

            const readableStream = new Readable();
            readableStream.push(source);
            readableStream.push(null);
            readableStream.pipe(uploadStream);
        });
    }

    // Trường hợp source là file path hoặc remote URL
    try {
        const result = await cloudinary.uploader.upload(source, uploadOptions);
        return {
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format,
            bytes: result.bytes,
        };
    } catch (err: any) {
        logger.error('Cloudinary upload error: ' + err.message);
        throw new Error(`Cloudinary upload failed: ${err.message}`);
    }
}

/**
 * Xóa tài nguyên trên Cloudinary theo publicId để tiết kiệm dung lượng.
 */
export async function deleteImage(publicId: string): Promise<{ success: boolean; result?: string }> {
    if (!publicId || !isCloudinaryEnabled()) {
        return { success: false, result: 'not_enabled_or_no_id' };
    }

    ensureConfigured();

    try {
        const res = await cloudinary.uploader.destroy(publicId, { invalidate: true });
        logger.info(`Đã xóa ảnh Cloudinary ${publicId}: ${res.result}`);
        return { success: res.result === 'ok', result: res.result };
    } catch (err: any) {
        logger.warn(`Lỗi khi xóa ảnh Cloudinary ${publicId}: ${err.message}`);
        return { success: false, result: err.message };
    }
}

/**
 * Tạo URL tối ưu động (CDN delivery) với kích thước và chất lượng tùy chỉnh.
 */
export function getOptimizedUrl(
    publicId: string,
    options: { width?: number; height?: number; crop?: string; quality?: string | number } = {}
): string {
    if (!publicId) return '';
    ensureConfigured();

    return cloudinary.url(publicId, {
        secure: true,
        fetch_format: 'auto',
        quality: options.quality || 'auto',
        width: options.width,
        height: options.height,
        crop: options.crop || (options.width && options.height ? 'fill' : undefined),
    });
}

export const CloudinaryService = {
    isCloudinaryEnabled,
    uploadImage,
    deleteImage,
    getOptimizedUrl,
};

export default CloudinaryService;

