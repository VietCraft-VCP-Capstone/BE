import sharp from 'sharp';
import fs from 'fs';
import mongoose from 'mongoose';
import { Design } from '../infrastructure/models/design.model';
import { publicUrl, resolveUploadPath } from '../../../shared/upload/upload.middleware';
import { isCloudinaryEnabled, uploadImage } from '../../../infrastructure/storage/cloudinary.service';

export class ForbiddenError extends Error {}

/** Bỏ ký tự điều khiển và giới hạn độ dài tên thiết kế. */
function sanitizeName(value?: string): string {
    // eslint-disable-next-line no-control-regex
    return (value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
}

export class DesignService {
    /**
     * Nhận artwork của seller, xác thực bằng sharp rồi cất đi.
     *
     * Nơi cất phụ thuộc cấu hình: có Cloudinary thì đẩy lên CDN và lưu URL https;
     * chưa cấu hình thì giữ nguyên đường cũ (ghi vào BE/uploads, lưu path tương đối).
     * Multer đưa file vào RAM (memoryStorage) hay ra đĩa (diskStorage) tuỳ theo cùng
     * điều kiện đó, nên ở đây phải đọc được cả `buffer` lẫn `path`.
     */
    static async uploadDesign(sellerId: string, file: Express.Multer.File, name?: string) {
        const source: Buffer | string = (file as any).buffer ?? file.path;
        // Chỉ có gì để dọn khi multer đã ghi ra đĩa. Nhánh RAM thì đây là no-op.
        const cleanupLocal = async () => {
            if (file.path) await fs.promises.unlink(file.path).catch(() => {});
        };

        let meta;
        try {
            // sharp là chốt chặn cuối: mimetype do client khai có thể giả, nội dung file mới là thật.
            meta = await sharp(source).metadata();
            if (!meta.width || !meta.height) throw new Error('invalid image');
        } catch {
            // Không để lại file rác trên đĩa (nó vẫn truy cập được qua /uploads).
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
                // Upload hỏng thì không được để lại bản nháp trên đĩa rồi im lặng bỏ qua.
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
            // Tên do client đặt: cắt ngắn + bỏ ký tự điều khiển trước khi lưu.
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
        // Ownership: seller chỉ xóa design của mình; admin được bypass (contract mục 2).
        const isAdmin = String(role || '').toLowerCase() === 'admin';
        if (!isAdmin && design.seller_id.toString() !== sellerId) {
            throw new ForbiddenError('Không thể xóa thiết kế của người khác');
        }
        // Xóa file trên đĩa (best-effort), chỉ khi đường dẫn nằm trong thư mục uploads.
        // Ảnh trên Cloudinary cố ý KHÔNG xoá tận gốc: resolveUploadPath trả null cho URL
        // tuyệt đối, nên chỗ này bỏ qua chúng. Bản ghi biến mất khỏi DB là đủ.
        const abs = resolveUploadPath(design.file_url);
        if (abs) fs.promises.unlink(abs).catch(() => {});
        await Design.findByIdAndDelete(id);
        return { deleted: true };
    }
}
export default DesignService;
