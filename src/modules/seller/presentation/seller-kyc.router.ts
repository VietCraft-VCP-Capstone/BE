import { Router, Response } from 'express';
import { SellerKycService } from '../application/seller-kyc.service';
import { authenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { uploadKycDocument } from '../../../shared/upload/kyc-storage.middleware';
import { generatePresignedToken } from '../../../shared/utils/crypto.service';
import { logger } from '../../../shared/utils/logger';

const router = Router();

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

        const filePath = SellerKycService.getSecureFilePath(filename, token, role, userId);
        if (!filePath) {
            return res.status(403).json({ error: 'Truy cập bị từ chối: Đường dẫn tài liệu riêng tư không hợp lệ hoặc đã hết hạn.' });
        }

        res.sendFile(filePath);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * 8. Quét OCR CCCD & kiểm tra thật/giả bằng AI EasyOCR
 */
router.post('/scan-cccd', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { filename, side = 'front' } = req.body;
        if (!filename) {
            return res.status(400).json({ success: false, error: 'Thiếu tên file ảnh CCCD để quét.' });
        }
        if (side !== 'front' && side !== 'back') {
            return res.status(400).json({ success: false, error: 'Tham số side phải là "front" hoặc "back".' });
        }

        const result = await SellerKycService.scanCccd(filename, side);
        res.status(200).json(result);
    } catch (error: any) {
        logger.error(`[Seller KYC Scan CCCD Error] User ${req.user?.id}: ${error.message}`);
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * 9. Kiểm tra ảnh chân dung bằng AI
 */
router.post('/validate-portrait', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { filename } = req.body;
        if (!filename) {
            return res.status(400).json({ success: false, error: 'Thiếu tên file ảnh chân dung để kiểm tra.' });
        }

        const result = await SellerKycService.validatePortrait(filename);
        res.status(200).json(result);
    } catch (error: any) {
        logger.error(`[Seller KYC Validate Portrait Error] User ${req.user?.id}: ${error.message}`);
        res.status(400).json({ success: false, error: error.message });
    }
});

export const sellerKycRouter = router;

