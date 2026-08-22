import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// ponytail: local disk storage cho MVP. Upgrade path: multer-s3 / Cloudinary khi cần CDN + scale.
export const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
export const DESIGN_DIR = path.join(UPLOAD_ROOT, 'designs');
export const MOCKUP_DIR = path.join(UPLOAD_ROOT, 'mockups');
for (const dir of [UPLOAD_ROOT, DESIGN_DIR, MOCKUP_DIR]) fs.mkdirSync(dir, { recursive: true });

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DESIGN_DIR),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.png';
        cb(null, `${crypto.randomUUID()}${ext}`);
    },
});

export const uploadDesign = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
        if (ALLOWED.has(file.mimetype)) cb(null, true);
        else cb(new Error('Chỉ chấp nhận ảnh PNG/JPG/WebP.'));
    },
});

/** URL công khai của 1 file đã lưu (relative — FE ghép origin). */
export const publicUrl = (absPath: string) => '/uploads/' + path.relative(UPLOAD_ROOT, absPath).split(path.sep).join('/');
