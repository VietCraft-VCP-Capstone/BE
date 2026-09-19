import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Thư mục lưu file KYC riêng tư, KHÔNG serve tĩnh qua public /uploads
export const KYC_STORAGE_ROOT = path.resolve(process.cwd(), 'storage', 'kyc_private');
if (!fs.existsSync(KYC_STORAGE_ROOT)) {
    fs.mkdirSync(KYC_STORAGE_ROOT, { recursive: true });
}

// Whitelist mimetype định dạng hợp lệ
const ALLOWED_MIME = new Map<string, string>([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/jpg', '.jpg'],
    ['image/webp', '.webp'],
    ['application/pdf', '.pdf'],
]);

const kycDiskStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, KYC_STORAGE_ROOT),
    filename: (_req, file, cb) => {
        const ext = ALLOWED_MIME.get(file.mimetype) || '.jpg';
        cb(null, `kyc_${crypto.randomUUID()}${ext}`);
    },
});

export const uploadKycDocument = multer({
    storage: kycDiskStorage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
        files: 1
    },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.has(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Chỉ chấp nhận file ảnh PNG, JPG, WebP hoặc tài liệu PDF (tối đa 10MB).'));
        }
    },
});

/**
 * Kiểm tra và lấy đường dẫn file an toàn trong thư mục KYC riêng tư
 */
export function resolveKycFilePath(filename: string): string | null {
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return null;
    }
    const resolvedPath = path.resolve(KYC_STORAGE_ROOT, filename);
    if (!resolvedPath.startsWith(KYC_STORAGE_ROOT)) {
        return null;
    }
    if (!fs.existsSync(resolvedPath)) {
        return null;
    }
    return resolvedPath;
}
