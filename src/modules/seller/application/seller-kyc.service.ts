import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { User } from '../../user/infrastructure/models/user.model';
import {
    SellerApplication,
    ISellerApplication,
    SellerType
} from '../infrastructure/models/seller-application.model';
import { OtpVerification } from '../../auth/infrastructure/models/otp.model';
import {
    encryptField,
    decryptField,
    maskCardNumber,
    maskBankAccount,
    areNamesMatching,
    generatePresignedToken,
    verifyPresignedToken,
    decryptBuffer,
    encryptBuffer,
    isBufferEncrypted
} from '../../../shared/utils/crypto.service';
import { resolveKycFilePath, KYC_STORAGE_ROOT, verifyKycFileOwnership } from '../../../shared/upload/kyc-storage.middleware';
import { config } from '../../../app/config';
import { generateSlug } from '../../../shared/utils/slug';
import { logger } from '../../../shared/utils/logger';
import { sendPhoneVerificationOtpEmail } from '../../../shared/utils/email.service';
import { SmsService } from '../../../shared/utils/sms.service';

const PHONE_OTP_TTL_MS = 5 * 60 * 1000;
const PHONE_REGEX = /^(0|84)(3|5|7|8|9)[0-9]{8}$/;

export class SellerKycService {
    static async getKycStatus(userId: string) {
        const user = await User.findById(userId);
        if (!user) throw new Error('Người dùng không tồn tại.');

        const application = await SellerApplication.findOne({ user_id: user._id }).sort({ updated_at: -1 });

        let fileUrls: Record<string, string> = {};
        if (application?.kyc_data) {
            const { front_id_image, back_id_image, portrait_image, business_license_image } = application.kyc_data;
            if (front_id_image) {
                fileUrls.front_id_url = `/api/seller/kyc/files/${front_id_image}?token=${generatePresignedToken(front_id_image).token}`;
            }
            if (back_id_image) {
                fileUrls.back_id_url = `/api/seller/kyc/files/${back_id_image}?token=${generatePresignedToken(back_id_image).token}`;
            }
            if (portrait_image) {
                fileUrls.portrait_url = `/api/seller/kyc/files/${portrait_image}?token=${generatePresignedToken(portrait_image).token}`;
            }

            if (business_license_image) {
                fileUrls.business_license_url = `/api/seller/kyc/files/${business_license_image}?token=${generatePresignedToken(business_license_image).token}`;
            }
        }

        return {
            user: {
                id: user._id,
                email: user.email,
                name: user.full_name,
                phone: user.phone || '',
                role: user.role,
                is_phone_verified: !!user.is_phone_verified,
                is_email_verified: !!user.is_email_verified,
                seller_status: user.seller_status || 'NONE'
            },
            application: application ? {
                id: application._id,
                seller_type: application.seller_type,
                status: application.status,
                phone: application.phone,
                is_phone_verified: application.is_phone_verified,
                email: application.email,
                is_email_verified: application.is_email_verified,
                kyc_data: {
                    full_name: application.kyc_data.full_name,
                    id_card_number_masked: maskCardNumber(decryptField(application.kyc_data.identity_card_number_encrypted)),
                    date_of_birth: application.kyc_data.date_of_birth,
                    id_issue_date: application.kyc_data.id_issue_date,
                    id_issue_place: application.kyc_data.id_issue_place,
                    tax_code: application.kyc_data.tax_code,
                    company_name: application.kyc_data.company_name,
                    business_license_number_masked: application.kyc_data.business_license_number_encrypted
                        ? maskCardNumber(decryptField(application.kyc_data.business_license_number_encrypted))
                        : undefined,
                    legal_rep_name: application.kyc_data.legal_rep_name,
                    legal_rep_position: application.kyc_data.legal_rep_position,
                    ...fileUrls
                },
                shop_info: application.shop_info,
                bank_info: {
                    bank_code: application.bank_info.bank_code,
                    bank_name: application.bank_info.bank_name,
                    account_number_masked: maskBankAccount(decryptField(application.bank_info.account_number_encrypted)),
                    account_holder: application.bank_info.account_holder,
                    is_name_matched: application.bank_info.is_name_matched
                },
                compliance: {
                    agreed_terms: application.compliance.agreed_terms,
                    agreed_pdpd_policy: application.compliance.agreed_pdpd_policy,
                    electronic_signature: application.compliance.electronic_signature,
                    signed_at: application.compliance.signed_at
                },
                review: application.review,
                created_at: application.created_at,
                updated_at: application.updated_at
            } : null
        };
    }

    static async sendPhoneOtp(userId: string, rawPhone: string) {
        const phone = String(rawPhone || '').trim();
        if (!PHONE_REGEX.test(phone)) {
            throw new Error('Số điện thoại không đúng định dạng di động Việt Nam (ví dụ: 0912345678).');
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expired_at = new Date(Date.now() + PHONE_OTP_TTL_MS);

        await OtpVerification.deleteMany({ phone, purpose: 'PHONE_VERIFY' });
        await OtpVerification.create({
            phone,
            otp_code: otp,
            purpose: 'PHONE_VERIFY',
            expired_at,
            attempts: 0
        });

        // Gửi SMS thật đến số điện thoại qua SpeedSMS
        const smsResult = await SmsService.sendOtp(phone, otp);

        // Gửi email dự phòng song song
        const user = await User.findById(userId);
        if (user && user.email) {
            await sendPhoneVerificationOtpEmail(user.email, phone, otp);
            logger.info(`📧 Đã gửi email dự phòng mã OTP tới: ${user.email}`);
        }

        logger.info(`📱 SMS OTP -> ${phone}: [ ${otp} ] (SpeedSMS status: ${smsResult.success ? 'SENT' : smsResult.message})`);

        return {
            success: true,
            message: `Mã xác thực OTP đã được gửi tới số điện thoại ${phone}. Vui lòng kiểm tra tin nhắn trên điện thoại của bạn.`,
            smsSent: smsResult.success,
            sentToEmail: user?.email || null
        };
    }

    static async verifyPhoneOtp(userId: string, rawPhone: string, code: string) {
        const phone = String(rawPhone || '').trim();
        const inputCode = String(code || '').trim();

        if (!phone || !inputCode) {
            throw new Error('Vui lòng nhập đầy đủ số điện thoại và mã OTP.');
        }

        const pending = await OtpVerification.findOne({ phone, purpose: 'PHONE_VERIFY' });
        if (!pending) {
            throw new Error('Mã OTP không tồn tại hoặc đã hết hạn.');
        }

        if (pending.expired_at.getTime() <= Date.now()) {
            await OtpVerification.deleteOne({ _id: pending._id });
            throw new Error('Mã OTP đã hết hạn. Vui lòng yêu cầu mã mới.');
        }

        if (pending.otp_code !== inputCode) {
            const updated = await OtpVerification.findOneAndUpdate(
                { _id: pending._id },
                { $inc: { attempts: 1 } },
                { new: true }
            );
            if (updated && updated.attempts >= 5) {
                await OtpVerification.deleteOne({ _id: pending._id });
                throw new Error('Bạn đã nhập sai mã OTP quá 5 lần. Vui lòng yêu cầu mã mới.');
            }
            throw new Error('Mã OTP không chính xác.');
        }

        await OtpVerification.deleteOne({ _id: pending._id });

        // Cập nhật trạng thái xác thực điện thoại ở User
        await User.findByIdAndUpdate(userId, {
            phone,
            is_phone_verified: true
        });

        // Đồng bộ trạng thái đã xác thực điện thoại ở SellerApplication (nếu có đơn DRAFT/PENDING)
        await SellerApplication.updateMany(
            { user_id: userId },
            { phone, is_phone_verified: true }
        );

        return {
            success: true,
            message: 'Xác thực số điện thoại thành công.'
        };
    }

    /**
     * Nộp hồ sơ đăng ký Seller (KYC Submission)
     */
    static async submitApplication(userId: string, payload: any, clientIp?: string) {
        const user = await User.findById(userId);
        if (!user) throw new Error('Người dùng không tồn tại.');

        if (user.role === 'SELLER') {
            throw new Error('Tài khoản này đã là Người bán trên hệ thống.');
        }

        if (!user.is_phone_verified && !payload.phone_verified) {
            throw new Error('Vui lòng xác thực số điện thoại qua OTP trước khi nộp hồ sơ.');
        }

        const sellerType: SellerType = payload.seller_type === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL';

        const kyc = payload.kyc_data || {};
        const fullName = String(kyc.full_name || user.full_name || '').trim();
        if (!fullName) throw new Error('Họ và tên trên CCCD không được để trống.');

        const idCardNumber = String(kyc.identity_card_number || '').trim();
        if (!idCardNumber || idCardNumber.length < 9) {
            throw new Error('Số Căn cước công dân (CCCD/CMND) không hợp lệ.');
        }

        if (sellerType === 'INDIVIDUAL') {
            if (!kyc.front_id_image || !kyc.back_id_image) {
                throw new Error('Vui lòng tải lên đầy đủ ảnh chụp 2 mặt Căn cước công dân.');
            }
            const taxCode = String(kyc.tax_code || '').trim();
            if (!taxCode) {
                throw new Error('Vui lòng nhập Mã số thuế cá nhân.');
            }
            if (!/^(\d{10}|\d{10}-\d{3}|\d{13})$/.test(taxCode)) {
                throw new Error('Mã số thuế cá nhân không hợp lệ. Vui lòng nhập đúng 10 chữ số (hoặc 13 số dạng XXXXXXXXXX-XXX).');
            }
        } else {
            if (!kyc.company_name) throw new Error('Vui lòng nhập tên Hộ kinh doanh hoặc Doanh nghiệp.');
            const bizTax = String(kyc.business_license_number || kyc.tax_code || '').trim();
            if (!bizTax) {
                throw new Error('Vui lòng nhập Mã số thuế / Mã số doanh nghiệp.');
            }
            if (!/^(\d{10}|\d{10}-\d{3}|\d{13})$/.test(bizTax)) {
                throw new Error('Mã số thuế doanh nghiệp không hợp lệ (10 hoặc 13 chữ số).');
            }
            if (!kyc.business_license_image) throw new Error('Vui lòng tải lên Giấy chứng nhận đăng ký kinh doanh.');
            if (!kyc.legal_rep_name) throw new Error('Vui lòng nhập thông tin người đại diện pháp luật.');
        }

        const shop = payload.shop_info || {};
        const shopName = String(shop.shop_name || '').trim();
        if (!shopName) throw new Error('Tên gian hàng không được để trống.');

        const pickup = shop.pickup_address || {};
        const pickupPhone = String(pickup.phone || '').trim();
        if (!pickup.recipient_name || !pickupPhone || !pickup.province_id || !pickup.district_id || !pickup.address_detail) {
            throw new Error('Vui lòng nhập đầy đủ thông tin địa chỉ lấy hàng.');
        }
        if (!/^0(3|5|7|8|9)\d{8}$/.test(pickupPhone)) {
            throw new Error('Số điện thoại liên hệ kho lấy hàng không hợp lệ. Vui lòng nhập số điện thoại di động 10 chữ số hợp lệ (bắt đầu bằng 03, 05, 07, 08, 09).');
        }

        const bank = payload.bank_info || {};
        const accountHolder = String(bank.account_holder || '').trim();
        const accountNumber = String(bank.account_number || '').trim();
        if (!bank.bank_code || !accountNumber || !accountHolder) {
            throw new Error('Vui lòng nhập đầy đủ thông tin tài khoản ngân hàng nhận thanh toán.');
        }
        if (!/^\d{6,20}$/.test(accountNumber)) {
            throw new Error('Số tài khoản ngân hàng không hợp lệ. Số tài khoản chỉ bao gồm từ 6 đến 20 chữ số.');
        }

        const nameToMatch = sellerType === 'INDIVIDUAL' ? fullName : (kyc.legal_rep_name || kyc.company_name);
        const isNameMatched = areNamesMatching(accountHolder, nameToMatch);
        if (!isNameMatched) {
            throw new Error(`Tên chủ tài khoản ngân hàng ("${accountHolder}") không khớp với tên trên giấy tờ định danh ("${nameToMatch}"). Vui lòng kiểm tra lại theo quy định pháp luật.`);
        }

        const compliance = payload.compliance || {};
        if (!compliance.agreed_terms) {
            throw new Error('Bạn cần đồng ý với Điều khoản dịch vụ dành cho Người bán VietCraft.');
        }

        // Xác minh quyền sở hữu toàn bộ file định danh KYC để chống IDOR nộp file người khác
        const uploadedKycFiles = [
            kyc.front_id_image,
            kyc.back_id_image,
            kyc.portrait_image,
            kyc.business_license_image,
        ].filter(Boolean);

        for (const f of uploadedKycFiles) {
            const isOwner = await verifyKycFileOwnership(f, userId, SellerApplication);
            if (!isOwner) {
                throw new Error(`Tài liệu "${f}" không thuộc quyền sở hữu của tài khoản bạn.`);
            }
        }
        if (!compliance.agreed_pdpd_policy) {
            throw new Error('Bạn cần đồng ý với Chính sách Bảo vệ Dữ liệu Cá nhân (Nghị định 13/2023/NĐ-CP) để tiếp tục.');
        }
        const signature = String(compliance.electronic_signature || fullName).trim();
        if (!signature) {
            throw new Error('Vui lòng ký tên xác nhận điện tử.');
        }

        const encryptedIdCard = encryptField(idCardNumber);
        const encryptedAccountNumber = encryptField(accountNumber);
        const encryptedBusinessLicense = kyc.business_license_number
            ? encryptField(String(kyc.business_license_number).trim())
            : undefined;

        const baseSlug = generateSlug(shopName);
        const shopSlug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;

        const applicationData = {
            user_id: user._id,
            seller_type: sellerType,
            status: 'PENDING_APPROVAL',
            phone: user.phone || payload.phone,
            is_phone_verified: true,
            email: user.email,
            is_email_verified: true,
            kyc_data: {
                full_name: fullName,
                identity_card_number_encrypted: encryptedIdCard,
                date_of_birth: kyc.date_of_birth,
                id_issue_date: kyc.id_issue_date,
                id_issue_place: kyc.id_issue_place,
                tax_code: kyc.tax_code,
                front_id_image: kyc.front_id_image,
                back_id_image: kyc.back_id_image,
                portrait_image: kyc.portrait_image,

                company_name: kyc.company_name,
                business_license_number_encrypted: encryptedBusinessLicense,
                business_license_image: kyc.business_license_image,
                legal_rep_name: kyc.legal_rep_name,
                legal_rep_position: kyc.legal_rep_position,
                legal_rep_id: kyc.legal_rep_id,
            },
            shop_info: {
                shop_name: shopName,
                shop_slug: shopSlug,
                description: shop.description,
                main_category: shop.main_category,
                pickup_address: {
                    recipient_name: String(pickup.recipient_name || fullName).trim(),
                    phone: String(pickup.phone || user.phone || payload.phone || '').trim(),
                    province_id: String(pickup.province_id || '').trim(),
                    district_id: String(pickup.district_id || '').trim(),
                    ward_code: String(pickup.ward_code || '').trim(),
                    address_detail: String(pickup.address_detail || '').trim(),
                },
            },
            bank_info: {
                bank_code: bank.bank_code,
                bank_name: bank.bank_name,
                account_number_encrypted: encryptedAccountNumber,
                account_holder: accountHolder,
                is_name_matched: true,
            },
            compliance: {
                agreed_terms: true,
                agreed_pdpd_policy: true,
                electronic_signature: signature,
                signed_at: new Date(),
                ip_address: clientIp || '127.0.0.1',
            }
        };

        const auditEntry = {
            action: 'SUBMITTED',
            actor_id: user._id,
            timestamp: new Date(),
            note: 'Người dùng nộp hồ sơ KYC đăng ký Người bán'
        };

        const existingApp = await SellerApplication.findOne({ user_id: user._id });
        let savedApp: ISellerApplication;

        if (existingApp) {
            Object.assign(existingApp, applicationData);
            existingApp.status = 'PENDING_APPROVAL';
            existingApp.review = undefined;
            if (!existingApp.audit_trail) existingApp.audit_trail = [];
            existingApp.audit_trail.push(auditEntry as any);
            savedApp = await existingApp.save();
        } else {
            (applicationData as any).audit_trail = [auditEntry];
            savedApp = await SellerApplication.create(applicationData);
        }

        await User.findByIdAndUpdate(user._id, {
            seller_status: 'PENDING',
            seller_application_id: savedApp._id
        });

        logger.info(`[Seller KYC] Người dùng ${user.email} đã nộp hồ sơ đăng ký Seller: ID ${savedApp._id}`);

        return {
            success: true,
            message: 'Nộp hồ sơ đăng ký Người bán thành công. Vui lòng chờ Ban Quản trị phê duyệt trong 24-48 giờ.',
            applicationId: savedApp._id
        };
    }

    static async cancelOrDeleteApplication(userId: string) {
        const app = await SellerApplication.findOne({ user_id: userId });
        if (!app) throw new Error('Không tìm thấy hồ sơ đăng ký.');

        if (app.status === 'APPROVED') {
            throw new Error('Gian hàng đã được phê duyệt và đang hoạt động. Vui lòng liên hệ Hỗ trợ để thực hiện quy trình đóng gian hàng và xóa dữ liệu.');
        }

        const filesToDelete = [
            app.kyc_data?.front_id_image,
            app.kyc_data?.back_id_image,
            app.kyc_data?.portrait_image,
            app.kyc_data?.business_license_image
        ].filter(Boolean) as string[];

        for (const fname of filesToDelete) {
            const absPath = resolveKycFilePath(fname);
            if (absPath && fs.existsSync(absPath)) {
                try {
                    fs.unlinkSync(absPath);
                } catch (e: any) {
                    logger.warn(`Không thể xóa file KYC ${fname}: ${e.message}`);
                }
            }
        }

        await SellerApplication.deleteOne({ _id: app._id });
        await User.findByIdAndUpdate(userId, {
            seller_status: 'NONE',
            $unset: { seller_application_id: 1 }
        });

        return {
            success: true,
            message: 'Đã hủy hồ sơ và xóa toàn bộ dữ liệu định danh của bạn khỏi hệ thống theo quy định bảo vệ dữ liệu cá nhân.'
        };
    }

    static isAuthorizedToAccessFile(filename: string, token?: string, userRole?: string, userId?: string): boolean {
        const absPath = resolveKycFilePath(filename);
        if (!absPath) return false;

        if (token && verifyPresignedToken(filename, token)) {
            return true;
        }

        if (userRole === 'admin' || userRole === 'ADMIN') {
            return true;
        }

        if (userId) {
            const cleanUserId = String(userId).replace(/[^a-zA-Z0-9]/g, '');
            if (filename.startsWith(`kyc_${cleanUserId}_`)) {
                return true;
            }
        }

        return false;
    }

    static getSecureFilePath(filename: string, token?: string, userRole?: string, userId?: string) {
        if (!this.isAuthorizedToAccessFile(filename, token, userRole, userId)) {
            return null;
        }
        return resolveKycFilePath(filename);
    }

    /**
     * Đọc và giải mã dữ liệu file KYC từ đĩa (hỗ trợ at-rest encryption)
     * Tự động nâng cấp mã hóa file cũ lên AES-256-GCM khi được truy cập (On-the-fly migration)
     */
    static readKycFileBuffer(filename: string): Buffer | null {
        const absPath = resolveKycFilePath(filename);
        if (!absPath || !fs.existsSync(absPath)) return null;
        const diskBuffer = fs.readFileSync(absPath);
        if (!isBufferEncrypted(diskBuffer)) {
            try {
                const encrypted = encryptBuffer(diskBuffer);
                fs.writeFileSync(absPath, encrypted);
                logger.info(`[KYC Storage] Đã tự động nâng cấp mã hóa AES-256-GCM cho file cũ: ${filename}`);
            } catch (err: any) {
                logger.warn(`[KYC Storage] Không thể ghi đè file mã hóa ${filename}: ${err.message}`);
            }
            return diskBuffer;
        }
        return decryptBuffer(diskBuffer);
    }

    static async scanCccd(filename: string, side: 'front' | 'back' = 'front') {
        const fileBuffer = this.readKycFileBuffer(filename);
        if (!fileBuffer) {
            throw new Error('Không tìm thấy file ảnh tài liệu để quét.');
        }
        const ext = path.extname(filename).toLowerCase();
        let mimeType = 'image/jpeg';
        if (ext === '.png') mimeType = 'image/png';
        if (ext === '.webp') mimeType = 'image/webp';

        const formData = new FormData();
        const blob = new Blob([fileBuffer], { type: mimeType });
        formData.append('file', blob, filename);
        formData.append('side', side);

        const aiUrl = `${config.aiAnalyticsUrl}/api/v1/ocr/cccd/`;
        logger.info(`[Seller KYC] Sending CCCD scan request to AI service: ${aiUrl} (side=${side})`);

        const headers: Record<string, string> = {};
        if (config.aiGatewaySecret) {
            headers['X-Gateway-Secret'] = config.aiGatewaySecret;
        }

        try {
            const response = await fetch(aiUrl, {
                method: 'POST',
                headers,
                body: formData,
                signal: AbortSignal.timeout(30000), // OCR quét ảnh tiếng Việt mất 5-15s trên CPU
            });

            if (!response.ok) {
                const errText = await response.text();
                logger.error(`[Seller KYC] AI OCR Service Error (${response.status}): ${errText}`);
                throw new Error(`AI OCR Service trả về lỗi: ${errText}`);
            }

            const data = await response.json();
            return data;
        } catch (error: any) {
            const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
            if (timedOut) {
                logger.error('[Seller KYC] AI OCR Service timeout sau 30s');
                throw new Error('Hệ thống AI xử lý quá thời gian quy định (timeout 30s). Vui lòng thử lại.');
            }
            throw error;
        }
    }

    static async validatePortrait(filename: string) {
        const fileBuffer = this.readKycFileBuffer(filename);
        if (!fileBuffer) {
            throw new Error('Không tìm thấy file ảnh chân dung để kiểm tra.');
        }
        const ext = path.extname(filename).toLowerCase();
        let mimeType = 'image/jpeg';
        if (ext === '.png') mimeType = 'image/png';
        if (ext === '.webp') mimeType = 'image/webp';

        const formData = new FormData();
        const blob = new Blob([fileBuffer], { type: mimeType });
        formData.append('file', blob, filename);

        const aiUrl = `${config.aiAnalyticsUrl}/api/v1/portrait/validate`;
        logger.info(`[Seller KYC] Sending portrait validation request to AI service: ${aiUrl}`);

        const headers: Record<string, string> = {};
        if (config.aiGatewaySecret) {
            headers['X-Gateway-Secret'] = config.aiGatewaySecret;
        }

        try {
            const response = await fetch(aiUrl, {
                method: 'POST',
                headers,
                body: formData,
                signal: AbortSignal.timeout(30000),
            });

            if (!response.ok) {
                const errText = await response.text();
                logger.error(`[Seller KYC] AI Portrait Validation Error (${response.status}): ${errText}`);
                throw new Error(`AI Portrait Service trả về lỗi: ${errText}`);
            }

            const data = await response.json();
            return data;
        } catch (error: any) {
            const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
            if (timedOut) {
                logger.error('[Seller KYC] AI Portrait Service timeout sau 30s');
                throw new Error('Hệ thống AI xử lý quá thời gian quy định (timeout 30s). Vui lòng thử lại.');
            }
            throw error;
        }
    }

    /**
     * Dọn dẹp các file KYC mồ côi (tải lên nhưng không nộp đơn hoặc đổi ảnh quá 24h).
     * Bắt buộc số giờ phải là số nguyên dương (từ 1 đến 720 giờ) để tránh việc xóa nhầm file mới upload.
     */
    static async cleanupOrphanKycFiles(olderThanHours: number = 24): Promise<{ deletedCount: number; scannedCount: number }> {
        if (typeof olderThanHours !== 'number' || isNaN(olderThanHours) || olderThanHours < 1 || olderThanHours > 720) {
            throw new Error('Số giờ giới hạn (olderThanHours) không hợp lệ. Phải là số nguyên dương từ 1 đến 720 giờ (tối đa 30 ngày).');
        }

        if (!fs.existsSync(KYC_STORAGE_ROOT)) return { deletedCount: 0, scannedCount: 0 };
        
        const files = fs.readdirSync(KYC_STORAGE_ROOT);
        const now = Date.now();
        const thresholdMs = olderThanHours * 60 * 60 * 1000;

        const applications = await SellerApplication.find({}).select('kyc_data').lean();
        const activeFiles = new Set<string>();
        for (const app of applications) {
            if (app.kyc_data) {
                if (app.kyc_data.front_id_image) activeFiles.add(app.kyc_data.front_id_image);
                if (app.kyc_data.back_id_image) activeFiles.add(app.kyc_data.back_id_image);
                if (app.kyc_data.portrait_image) activeFiles.add(app.kyc_data.portrait_image);
                if (app.kyc_data.business_license_image) activeFiles.add(app.kyc_data.business_license_image);
            }
        }

        let deletedCount = 0;
        for (const file of files) {
            if (activeFiles.has(file)) continue;
            const filePath = path.join(KYC_STORAGE_ROOT, file);
            try {
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > thresholdMs) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            } catch (err: any) {
                logger.warn(`[KYC Cleanup] Không thể xóa file mồ côi ${file}: ${err.message}`);
            }
        }
        logger.info(`[KYC Cleanup] Đã dọn dẹp ${deletedCount}/${files.length} file tạm mồ côi (cũ hơn ${olderThanHours} giờ).`);
        return { deletedCount, scannedCount: files.length };
    }

    /**
     * Chuyển đổi hàng loạt các file KYC cũ chưa được mã hóa sang chuẩn AES-256-GCM
     */
    static async migrateUnencryptedKycFiles(): Promise<{ migratedCount: number; alreadyEncryptedCount: number; totalCount: number }> {
        if (!fs.existsSync(KYC_STORAGE_ROOT)) return { migratedCount: 0, alreadyEncryptedCount: 0, totalCount: 0 };

        const files = fs.readdirSync(KYC_STORAGE_ROOT);
        let migratedCount = 0;
        let alreadyEncryptedCount = 0;

        for (const file of files) {
            const filePath = path.join(KYC_STORAGE_ROOT, file);
            try {
                const stats = fs.statSync(filePath);
                if (!stats.isFile()) continue;

                const raw = fs.readFileSync(filePath);
                if (isBufferEncrypted(raw)) {
                    alreadyEncryptedCount++;
                } else {
                    const encrypted = encryptBuffer(raw);
                    fs.writeFileSync(filePath, encrypted);
                    migratedCount++;
                }
            } catch (err: any) {
                logger.error(`[KYC Migration] Lỗi khi chuyển đổi file ${file}: ${err.message}`);
            }
        }

        logger.info(`[KYC Migration] Chuyển đổi mã hóa hoàn tất: ${migratedCount} file đã mã hóa, ${alreadyEncryptedCount} file đã mã hóa trước đó, tổng cộng ${files.length} file.`);
        return { migratedCount, alreadyEncryptedCount, totalCount: files.length };
    }
}

