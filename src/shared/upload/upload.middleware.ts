import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { isCloudinaryEnabled } from '../../infrastructure/storage/cloudinary.service';

// Đĩa local là đường lui khi chưa cấu hình Cloudinary (xem cloudinary.service.ts).
export const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
export const DESIGN_DIR = path.join(UPLOAD_ROOT, 'designs');
export const MOCKUP_DIR = path.join(UPLOAD_ROOT, 'mockups');
for (const dir of [UPLOAD_ROOT, DESIGN_DIR, MOCKUP_DIR]) fs.mkdirSync(dir, { recursive: true });

// Whitelist mimetype -> đuôi file do SERVER quyết định.
const ALLOWED = new Map<string, string>([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/webp', '.webp'],
]);

const diskStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DESIGN_DIR),
    filename: (_req, file, cb) => {
        // Tên file = UUID + đuôi suy ra từ mimetype đã whitelist.
        // KHÔNG dùng originalname: client có thể gửi '../../x' (path traversal) hoặc 'a.html'
        // -> file .html nằm trong /uploads được serve tĩnh = stored XSS trên chính origin của API.
        const ext = ALLOWED.get(file.mimetype) || '.png';
        cb(null, `${crypto.randomUUID()}${ext}`);
    },
});

// Có Cloudinary thì giữ file trong RAM: ảnh không bao giờ chạm đĩa, nên cũng không
// có khoảng thời gian nó nằm trong /uploads (đang được serve tĩnh) trước khi bị xoá.
const storage = isCloudinaryEnabled() ? multer.memoryStorage() : diskStorage;

export const uploadDesign = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10MB, 1 file/request
    fileFilter: (_req, file, cb) => {
        if (ALLOWED.has(file.mimetype)) cb(null, true);
        else cb(new Error('Chỉ chấp nhận ảnh PNG/JPG/WebP.'));
    },
});

/**
 * Đường dẫn tuyệt đối an toàn từ public URL: chặn mọi thứ thoát khỏi UPLOAD_ROOT.
 * URL tuyệt đối (ảnh trên Cloudinary) không phải file local -> null, để caller bỏ qua
 * thay vì ghép nhầm thành UPLOAD_ROOT/https:/res.cloudinary.com/... rồi unlink hụt.
 */
export function resolveUploadPath(url: string): string | null {
    if (!url || !url.startsWith('/uploads/')) return null;
    const rel = url.replace(/^\/uploads\//, '');
    const abs = path.resolve(UPLOAD_ROOT, rel);
    if (abs !== UPLOAD_ROOT && !abs.startsWith(UPLOAD_ROOT + path.sep)) return null;
    return abs;
}

/** URL công khai của 1 file đã lưu (relative — FE ghép origin). */
export const publicUrl = (absPath: string) => '/uploads/' + path.relative(UPLOAD_ROOT, absPath).split(path.sep).join('/');
