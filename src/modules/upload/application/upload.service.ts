import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import sharp from 'sharp';
import { isCloudinaryEnabled, uploadImage, deleteImage, CloudinaryAsset } from '../../../infrastructure/storage/cloudinary.service';
import { UPLOAD_ROOT, publicUrl } from '../../../shared/upload/upload.middleware';
import { logger } from '../../../shared/utils/logger';

export interface UploadResult {
    url: string;
    publicId?: string;
    width?: number;
    height?: number;
    format?: string;
    bytes?: number;
    storage: 'cloudinary' | 'local';
}

export class UploadService {
    /**
     * Tải lên 1 ảnh đơn lẻ (từ RAM Buffer của Multer).
     * Hỗ trợ tự động chuyển đổi sang Cloudinary, có fallback lưu local nếu Cloudinary tắt hoặc gặp lỗi.
     */
    static async uploadSingle(
        file: Express.Multer.File,
        options: { folder?: string; isAvatar?: boolean } = {}
    ): Promise<UploadResult> {
        if (!file || !file.buffer) {
            throw new Error('Không nhận được dữ liệu tệp tin.');
        }

        // 1. Kiểm tra tính hợp lệ của ảnh bằng sharp (magic bytes)
        let meta;
        try {
            meta = await sharp(file.buffer).metadata();
            if (!meta.width || !meta.height) {
                throw new Error('Ảnh không có kích thước hợp lệ.');
            }
        } catch {
            throw new Error('Tệp tải lên không phải là định dạng ảnh hợp lệ (PNG, JPG, WebP).');
        }

        const folder = options.folder || 'general';
        let bufferToSave = file.buffer;

        // 2. Thử upload lên Cloudinary trước
        if (isCloudinaryEnabled()) {
            try {
                const transformations: any[] = [];
                if (options.isAvatar) {
                    transformations.push({
                        width: 400,
                        height: 400,
                        crop: 'fill',
                        gravity: 'face',
                    });
                }

                const asset: CloudinaryAsset = await uploadImage(file.buffer, {
                    folder: `vietcraft/${folder}`,
                    filename: file.originalname,
                    mimetype: file.mimetype,
                    transformation: transformations,
                });

                return {
                    url: asset.url,
                    publicId: asset.publicId,
                    width: asset.width || meta.width,
                    height: asset.height || meta.height,
                    format: asset.format || meta.format,
                    bytes: asset.bytes || file.size,
                    storage: 'cloudinary',
                };
            } catch (err: any) {
                logger.warn(`Cloudinary upload failed (${err.message}). Tự động fallback lưu vào ổ đĩa local.`);
            }
        }

        // 3. Fallback: Lưu vào đĩa cục bộ (uploads/<folder>/<uuid>.<ext>)
        if (options.isAvatar) {
            // Cắt vuông 400x400 cho avatar nếu lưu local
            bufferToSave = await sharp(file.buffer)
                .resize(400, 400, { fit: 'cover', position: 'center' })
                .toBuffer();
        }

        const ext = file.mimetype === 'image/jpeg' ? '.jpg' : file.mimetype === 'image/webp' ? '.webp' : '.png';
        const filename = `${crypto.randomUUID()}${ext}`;
        const targetDir = path.join(UPLOAD_ROOT, folder);
        await fs.promises.mkdir(targetDir, { recursive: true });

        const absPath = path.join(targetDir, filename);
        await fs.promises.writeFile(absPath, bufferToSave);

        return {
            url: publicUrl(absPath),
            width: options.isAvatar ? 400 : meta.width,
            height: options.isAvatar ? 400 : meta.height,
            format: meta.format || 'png',
            bytes: bufferToSave.length,
            storage: 'local',
        };
    }

    /**
     * Xóa ảnh: Xóa trên Cloudinary nếu có publicId, hoặc xóa file local nếu là đường dẫn /uploads/.
     */
    static async deleteResource(identifier: string): Promise<{ success: boolean; message: string }> {
        if (!identifier) {
            return { success: false, message: 'Thiếu định danh ảnh cần xóa.' };
        }

        // Nếu là publicId của Cloudinary
        if (identifier.includes('vietcraft/') || !identifier.startsWith('/uploads/')) {
            const clRes = await deleteImage(identifier);
            if (clRes.success) {
                return { success: true, message: 'Đã xóa ảnh trên Cloudinary thành công.' };
            }
        }

        // Nếu là URL local /uploads/...
        if (identifier.startsWith('/uploads/')) {
            const rel = identifier.replace(/^\/uploads\//, '');
            const abs = path.resolve(UPLOAD_ROOT, rel);
            if (abs.startsWith(UPLOAD_ROOT)) {
                try {
                    await fs.promises.unlink(abs);
                    return { success: true, message: 'Đã xóa file cục bộ thành công.' };
                } catch {
                    // file có thể đã không tồn tại
                }
            }
        }

        return { success: true, message: 'Hoàn tất xử lý yêu cầu xóa.' };
    }
}

export default UploadService;
