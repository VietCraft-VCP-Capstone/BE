import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Thư mục lưu file KYC riêng tư, KHÔNG serve tĩnh qua public /uploads
export const KYC_STORAGE_ROOT = path.resolve(process.cwd(), 'storage', 'kyc_private');
if (!fs.existsSync(KYC_STORAGE_ROOT)) {
    fs.mkdirSync(KYC_STORAGE_ROOT, { recursive: true, mode: 0o700 });
}

// Whitelist mimetype định dạng hợp lệ
const ALLOWED_MIME = new Map<string, string>([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/jpg', '.jpg'],
    ['image/webp', '.webp'],
    ['application/pdf', '.pdf'],
]);

import { encryptBuffer } from '../utils/crypto.service';

export const uploadKycDocument = multer({
    storage: multer.memoryStorage(),
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
 * Mã hóa AES-256-GCM trong bộ nhớ rồi mới ghi đĩa: ảnh gốc không bao giờ nằm trên ổ.
 * Trả về tên file đã lưu.
 */
export function saveEncryptedKycFile(userId: string, file: { mimetype: string; buffer: Buffer }): string {
    const cleanUserId = String(userId).replace(/[^a-zA-Z0-9]/g, '');
    const ext = ALLOWED_MIME.get(file.mimetype) || '.jpg';
    const filename = `kyc_${cleanUserId}_${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(KYC_STORAGE_ROOT, filename), encryptBuffer(file.buffer), { mode: 0o600 });
    return filename;
}

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

/**
 * Kiểm tra xem tên file có thuộc về người dùng đang gọi hay không (chống IDOR).
 */
export async function verifyKycFileOwnership(
    filename: string,
    userId: string,
    sellerApplicationModel?: any
): Promise<boolean> {
    if (!filename || !userId) return false;
    const cleanUserId = String(userId).replace(/[^a-zA-Z0-9]/g, '');

    // 1. Kiểm tra prefix user id gắn trực tiếp trong filename
    if (filename.startsWith(`kyc_${cleanUserId}_`)) {
        return true;
    }

    // 2. Fallback cho file cũ: kiểm tra trong cơ sở dữ liệu xem file có nằm trong hồ sơ của chính user này không
    if (sellerApplicationModel) {
        try {
            const app = await sellerApplicationModel.findOne({ user_id: userId }).lean();
            if (app?.kyc_data) {
                const files = [
                    app.kyc_data.front_id_image,
                    app.kyc_data.back_id_image,
                    app.kyc_data.portrait_image,
                    app.kyc_data.business_license_image,
                ].filter(Boolean);
                if (files.includes(filename)) {
                    return true;
                }
            }
        } catch { }
    }

    return false;
}
