import sharp from 'sharp';
import fs from 'fs';
import { Design } from '../infrastructure/models/design.model';
import { publicUrl } from '../../../shared/upload/upload.middleware';

export class ForbiddenError extends Error {}

export class DesignService {
    static async uploadDesign(sellerId: string, file: Express.Multer.File, name?: string) {
        const meta = await sharp(file.path).metadata();
        const design = await Design.create({
            seller_id: sellerId,
            name: name?.trim() || file.originalname,
            file_url: publicUrl(file.path),
            width_px: meta.width || 0,
            height_px: meta.height || 0,
        });
        return design;
    }

    static async listMyDesigns(sellerId: string) {
        return Design.find({ seller_id: sellerId }).sort({ created_at: -1 }).lean();
    }

    static async deleteDesign(id: string, sellerId: string) {
        const design = await Design.findById(id);
        if (!design) throw new Error('Design not found');
        // Ownership: seller chỉ xóa design của mình.
        if (design.seller_id.toString() !== sellerId) throw new ForbiddenError('Không thể xóa thiết kế của người khác');
        // Xóa file trên đĩa (best-effort).
        const abs = process.cwd() + '/uploads' + design.file_url.replace('/uploads', '');
        fs.promises.unlink(abs).catch(() => {});
        await Design.findByIdAndDelete(id);
        return { deleted: true };
    }
}
export default DesignService;
