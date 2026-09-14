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
    verifyPresignedToken
} from '../../../shared/utils/crypto.service';
import { resolveKycFilePath, KYC_STORAGE_ROOT } from '../../../shared/upload/kyc-storage.middleware';
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
        } else {
            if (!kyc.company_name) throw new Error('Vui lòng nhập tên Hộ kinh doanh hoặc Doanh nghiệp.');
            if (!kyc.business_license_image) throw new Error('Vui lòng tải lên Giấy chứng nhận đăng ký kinh doanh.');
            if (!kyc.legal_rep_name) throw new Error('Vui lòng nhập thông tin người đại diện pháp luật.');
        }

        const shop = payload.shop_info || {};
        const shopName = String(shop.shop_name || '').trim();
        if (!shopName) throw new Error('Tên gian hàng không được để trống.');

        const pickup = shop.pickup_address || {};
        if (!pickup.recipient_name || !pickup.phone || !pickup.province_id || !pickup.district_id || !pickup.address_detail) {
            throw new Error('Vui lòng nhập đầy đủ thông tin địa chỉ lấy hàng.');
        }

        const bank = payload.bank_info || {};
        const accountHolder = String(bank.account_holder || '').trim();
        const accountNumber = String(bank.account_number || '').trim();
        if (!bank.bank_code || !accountNumber || !accountHolder) {
            throw new Error('Vui lòng nhập đầy đủ thông tin tài khoản ngân hàng nhận thanh toán.');
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

    static getSecureFilePath(filename: string, token?: string, userRole?: string, userId?: string) {
        const absPath = resolveKycFilePath(filename);
        if (!absPath) return null;

        if (token && verifyPresignedToken(filename, token)) {
            return absPath;
        }

        if (userRole === 'admin' || userRole === 'ADMIN') {
            return absPath;
        }

        return null;
    }
}
