import sharp from 'sharp';
import fs from 'fs';
import mongoose from 'mongoose';
import { Design } from '../infrastructure/models/design.model';
import { publicUrl, resolveUploadPath } from '../../../shared/upload/upload.middleware';
import { isCloudinaryEnabled, uploadImage } from '../../../infrastructure/storage/cloudinary.service';

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
            let asset;
            try {
                asset = await uploadImage(buffer, { filename: file.originalname, mimetype: file.mimetype });
            } catch (err) {
                await cleanupLocal();
                throw err;
            }
            await cleanupLocal();
            fileUrl = asset.url;
            storage = 'cloudinary';
            publicId = asset.publicId;
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
        const abs = resolveUploadPath(design.file_url);
        if (abs) fs.promises.unlink(abs).catch(() => { });
        await Design.findByIdAndDelete(id);
        return { deleted: true };
    }
}
export default DesignService;
