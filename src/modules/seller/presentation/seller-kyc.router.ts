import { Router, Response } from 'express';
import path from 'path';
import { SellerKycService } from '../application/seller-kyc.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { uploadKycDocument, encryptUploadedKycFile, verifyKycFileOwnership } from '../../../shared/upload/kyc-storage.middleware';
import { SellerApplication } from '../infrastructure/models/seller-application.model';
import { generatePresignedToken } from '../../../shared/utils/crypto.service';
import { logger } from '../../../shared/utils/logger';

const router = Router();

// In-memory rate limiter cho các tác vụ tốn CPU như quét OCR CCCD / kiểm tra chân dung
const scanTimestamps = new Map<string, number[]>();

function kycScanRateLimiter(req: AuthenticatedRequest, res: Response, next: any) {
    const userId = req.user?.id || req.ip || 'unknown';
    const now = Date.now();
    const windowMs = 10 * 60 * 1000; // 10 phút
    const maxScans = 10; // Tối đa 10 lượt quét / 10 phút

    const timestamps = (scanTimestamps.get(userId) || []).filter(t => now - t < windowMs);
    if (timestamps.length >= maxScans) {
        return res.status(429).json({
            success: false,
            error: 'Bạn đã thực hiện quét quá nhiều lần liên tiếp. Vui lòng thử lại sau vài phút để bảo vệ tài nguyên hệ thống.'
        });
    }

    timestamps.push(now);
    scanTimestamps.set(userId, timestamps);
    next();
}

/**
 * 1. Lấy trạng thái KYC và thông tin hồ sơ của người dùng hiện tại
 */
router.get('/status', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await SellerKycService.getKycStatus(req.user!.id);
        res.status(200).json({ success: true, data: result });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * 2. Gửi mã OTP đến số điện thoại (Bước 1)
 */
router.post('/phone-otp/send', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { phone } = req.body;
        const result = await SellerKycService.sendPhoneOtp(req.user!.id, phone);
        res.status(200).json(result);
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * 3. Xác thực mã OTP số điện thoại (Bước 1)
 */
router.post('/phone-otp/verify', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { phone, code } = req.body;
        const result = await SellerKycService.verifyPhoneOtp(req.user!.id, phone, code);
        res.status(200).json(result);
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * 4. Tải lên tài liệu định danh riêng tư (CCCD, Chân dung, GPKD)
 */
router.post('/upload-doc', authenticate, uploadKycDocument.single('file'), async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Không tìm thấy file tải lên.' });
        }

        const filename = req.file.filename;

        // Mã hóa ảnh nhạy cảm trên đĩa ngay sau khi upload (AES-256-CBC at-rest encryption)
        encryptUploadedKycFile(req.file.path);

        const { token } = generatePresignedToken(filename, 3600); // 1 giờ cho phiên upload
        const secureUrl = `/api/seller/kyc/files/${filename}?token=${token}`;

        res.status(200).json({
            success: true,
            filename,
            secureUrl,
            message: 'Tải lên tài liệu thành công.'
        });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * 5. Nộp hồ sơ đăng ký Người bán đầy đủ (Bước 2 đến 6)
 */
router.post('/apply', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
        const result = await SellerKycService.submitApplication(req.user!.id, req.body, clientIp);
        res.status(200).json(result);
    } catch (error: any) {
        logger.error(`[Seller KYC Apply Error] User ${req.user?.id}: ${error.message}`);
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * 6. Hủy đơn / Xóa dữ liệu KYC cá nhân (Nghị định 13/2023 PDPD)
 */
router.delete('/cancel-or-delete', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await SellerKycService.cancelOrDeleteApplication(req.user!.id);
        res.status(200).json(result);
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * 7. Xem file định danh an toàn (Stream file có token presigned hoặc admin)
 */
router.get('/files/:filename', async (req: any, res: Response) => {
    try {
        const { filename } = req.params;
        const token = req.query.token as string | undefined;

        // Nếu caller gửi Authorization header
        const authHeader = req.headers.authorization;
        let role = '';
        let userId = '';
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const jwt = require('jsonwebtoken');
                const { config } = require('../../../app/config');
                const decoded = jwt.verify(authHeader.split(' ')[1], config.jwtSecret);
                role = decoded.role;
                userId = decoded.id;
            } catch { }
        }

        const isAllowed = SellerKycService.isAuthorizedToAccessFile(filename, token, role, userId);
        if (!isAllowed) {
            return res.status(403).json({ error: 'Truy cập bị từ chối: Đường dẫn tài liệu riêng tư không hợp lệ hoặc đã hết hạn.' });
        }

        const buffer = SellerKycService.readKycFileBuffer(filename);
        if (!buffer) {
            return res.status(404).json({ error: 'Không tìm thấy file tài liệu.' });
        }

        const ext = path.extname(filename).toLowerCase();
        let mime = 'image/jpeg';
        if (ext === '.png') mime = 'image/png';
        if (ext === '.webp') mime = 'image/webp';
        if (ext === '.pdf') mime = 'application/pdf';

        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.send(buffer);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * 8. Quét OCR CCCD & kiểm tra thật/giả bằng AI EasyOCR (có xác thực quyền sở hữu file & rate limit)
 */
router.post('/scan-cccd', authenticate, kycScanRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { filename, side = 'front' } = req.body;
        if (!filename) {
            return res.status(400).json({ success: false, error: 'Thiếu tên file ảnh CCCD để quét.' });
        }
        if (side !== 'front' && side !== 'back') {
            return res.status(400).json({ success: false, error: 'Tham số side phải là "front" hoặc "back".' });
        }

        // Chống IDOR: Ràng buộc người dùng chỉ được quét ảnh do chính tài khoản mình upload
        const isOwner = await verifyKycFileOwnership(filename, req.user!.id, SellerApplication);
        if (!isOwner) {
            return res.status(403).json({
                success: false,
                error: 'Truy cập bị từ chối: Bạn không có quyền truy cập hoặc quét tài liệu của người khác.'
            });
        }

        const result = await SellerKycService.scanCccd(filename, side);
        res.status(200).json(result);
    } catch (error: any) {
        logger.error(`[Seller KYC Scan CCCD Error] User ${req.user?.id}: ${error.message}`);
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * 9. Kiểm tra ảnh chân dung bằng AI (có xác thực quyền sở hữu file & rate limit)
 */
router.post('/validate-portrait', authenticate, kycScanRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { filename } = req.body;
        if (!filename) {
            return res.status(400).json({ success: false, error: 'Thiếu tên file ảnh chân dung để kiểm tra.' });
        }

        // Chống IDOR: Ràng buộc người dùng chỉ được kiểm tra ảnh chân dung của chính mình
        const isOwner = await verifyKycFileOwnership(filename, req.user!.id, SellerApplication);
        if (!isOwner) {
            return res.status(403).json({
                success: false,
                error: 'Truy cập bị từ chối: Bạn không có quyền kiểm tra tài liệu của người khác.'
            });
        }

        const result = await SellerKycService.validatePortrait(filename);
        res.status(200).json(result);
    } catch (error: any) {
        logger.error(`[Seller KYC Validate Portrait Error] User ${req.user?.id}: ${error.message}`);
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * 10. Dọn dẹp file KYC mồ côi (Admin only, có kiểm tra chặt chẽ số giờ)
 */
router.post('/cleanup-orphans', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const rawHours = req.query.hours;
        let hours = 24;
        if (rawHours !== undefined) {
            const parsed = Number(rawHours);
            if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 720) {
                return res.status(400).json({
                    success: false,
                    error: 'Tham số hours không hợp lệ. Phải là số nguyên dương từ 1 đến 720 (tối đa 30 ngày).'
                });
            }
            hours = parsed;
        }

        const result = await SellerKycService.cleanupOrphanKycFiles(hours);
        res.status(200).json({ success: true, ...result });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 11. Chuyển đổi mã hóa toàn bộ file KYC cũ sang chuẩn AES-256-GCM (Admin only)
 */
router.post('/migrate-encryption', authenticate, requireRole(['admin']), async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await SellerKycService.migrateUnencryptedKycFiles();
        res.status(200).json({ success: true, ...result });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export const sellerKycRouter = router;

