import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { Design } from '../infrastructure/models/design.model';
import { publicUrl, resolveUploadPath, DESIGN_DIR } from '../../../shared/upload/upload.middleware';
import { isCloudinaryEnabled, uploadImage, deleteImage } from '../../../infrastructure/storage/cloudinary.service';
import { logger } from '../../../shared/utils/logger';

export class ForbiddenError extends Error { }

function sanitizeName(value?: string): string {
    return (value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
}

export class DesignService {

    static async uploadDesign(sellerId: string, file: Express.Multer.File, name?: string) {
        const source: Buffer | string = (file as any).buffer ?? file.path;
        const cleanupLocal = async () => {
            if (file.path) await fs.promises.unlink(file.path).catch(() => { });
        };

        let meta;
        try {
            meta = await sharp(source).metadata();
            if (!meta.width || !meta.height) throw new Error('invalid image');
        } catch {
            await cleanupLocal();
            throw new Error('File không phải ảnh hợp lệ.');
        }

        let fileUrl: string;
        let storage: 'local' | 'cloudinary' = 'local';
        let publicId: string | undefined;

        if (isCloudinaryEnabled()) {
            const buffer = Buffer.isBuffer(source) ? source : await fs.promises.readFile(source);
            try {
                const asset = await uploadImage(buffer, { folder: 'designs', filename: file.originalname, mimetype: file.mimetype });
                await cleanupLocal();
                fileUrl = asset.url;
                storage = 'cloudinary';
                publicId = asset.publicId;
            } catch (err: any) {
                logger.warn(`Cloudinary upload failed (${err.message}), falling back to local file storage.`);
                const ext = file.mimetype === 'image/jpeg' ? '.jpg' : file.mimetype === 'image/webp' ? '.webp' : '.png';
                const filename = `${crypto.randomUUID()}${ext}`;
                const destPath = path.join(DESIGN_DIR, filename);
                await fs.promises.writeFile(destPath, buffer);
                await cleanupLocal();
                fileUrl = publicUrl(destPath);
                storage = 'local';
            }
        } else {
            fileUrl = publicUrl(file.path);
        }

        const design = await Design.create({
            seller_id: sellerId,
            name: sanitizeName(name) || sanitizeName(file.originalname) || 'design',
            file_url: fileUrl,
            storage,
            public_id: publicId,
            width_px: meta.width,
            height_px: meta.height,
        });
        return design;
    }

    static async listMyDesigns(sellerId: string) {
        return Design.find({ seller_id: sellerId }).sort({ created_at: -1 }).lean();
    }

    static async deleteDesign(id: string, sellerId: string, role?: string) {
        if (!mongoose.Types.ObjectId.isValid(id)) throw new Error('Design not found');
        const design = await Design.findById(id);
        if (!design) throw new Error('Design not found');
        const isAdmin = String(role || '').toLowerCase() === 'admin';
        if (!isAdmin && design.seller_id.toString() !== sellerId) {
            throw new ForbiddenError('Không thể xóa thiết kế của người khác');
        }
        if (design.storage === 'cloudinary' && design.public_id) {
            deleteImage(design.public_id).catch(() => { });
        }
        const abs = resolveUploadPath(design.file_url);
        if (abs) fs.promises.unlink(abs).catch(() => { });
        await Design.findByIdAndDelete(id);
        return { deleted: true };
    }
}
export default DesignService;
