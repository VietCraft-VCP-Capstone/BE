import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../../app/config';
import { User } from '../../user/infrastructure/models/user.model';
import { OtpVerification, IOtpVerification } from '../infrastructure/models/otp.model';
import { sendOtpEmail, sendResetPasswordEmail } from '../../../shared/utils/email.service';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const MIN_PASSWORD_LENGTH = 8;

/** Role được phép TỰ đăng ký. ADMIN cố tình không nằm ở đây: không ai tự phong admin. */
const SELF_SIGNUP_ROLES = ['BUYER', 'SELLER'] as const;
type SelfSignupRole = typeof SELF_SIGNUP_ROLES[number];

function generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/** Email luôn được chuẩn hoá về lowercase: nếu không, 'A@x.com' và 'a@x.com'
 *  tạo ra hai tài khoản khác nhau và OTP tra theo email sẽ không khớp. */
function normalizeEmail(email?: string): string {
    const value = String(email || '').trim().toLowerCase();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw new Error('Email không hợp lệ.');
    }
    return value;
}

function assertPassword(password?: string): string {
    const value = String(password || '');
    if (value.length < MIN_PASSWORD_LENGTH) {
        throw new Error(`Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`);
    }
    return value;
}

/** Chỉ chấp nhận BUYER/SELLER. Truyền ADMIN (hay gì khác) là lỗi 400, không âm thầm hạ cấp. */
function normalizeSignupRole(role?: string): SelfSignupRole {
    const value = String(role || 'BUYER').trim().toUpperCase();
    if (!SELF_SIGNUP_ROLES.includes(value as SelfSignupRole)) {
        throw new Error("Vai trò đăng ký không hợp lệ. Chỉ chấp nhận 'BUYER' hoặc 'SELLER'.");
    }
    return value as SelfSignupRole;
}

function generateToken(payload: { id: string; email: string; role: string }) {
    // Normalize role to lowercase so it matches route guards (requireRole(['admin']))
    const normalized = { ...payload, role: String(payload.role || '').toLowerCase() };
    return jwt.sign(normalized, config.jwtSecret, { expiresIn: '7d' });
}

function authResponse(user: any) {
    const token = generateToken({ id: user._id.toString(), email: user.email, role: user.role });
    return { token, user: { id: user._id, email: user.email, name: user.full_name, role: user.role } };
}

function logOtpFallback(title: string, error: any, otp: string) {
    console.warn('\n\n==================================================');
    console.warn(`⚠️ ${title}:`, error?.message);
    console.warn(`🔥 MÃ OTP CỦA BẠN: ${otp}`);
    console.warn('==================================================\n');
}

export class AuthService {
    /** Tiêu thụ OTP đúng MỘT lần: xoá atomic ngay khi khớp mã.
     *  Nhờ vậy hai request song song chỉ có một request thắng (chống dùng lại + race). */
    private static async consumeOtp(
        email: string,
        code: string,
        purpose: 'REGISTER' | 'FORGOT_PASSWORD'
    ): Promise<IOtpVerification> {
        const invalid = () => new Error('Mã OTP không hợp lệ hoặc đã hết hạn.');

        const pending = await OtpVerification.findOne({ email, purpose });
        if (!pending) throw invalid();

        if (pending.expired_at.getTime() <= Date.now()) {
            await OtpVerification.deleteOne({ _id: pending._id });
            throw new Error('Mã OTP đã hết hạn. Vui lòng bấm gửi lại mã.');
        }

        if (pending.otp_code !== String(code || '').trim()) {
            const updated = await OtpVerification.findOneAndUpdate(
                { _id: pending._id },
                { $inc: { attempts: 1 } },
                { new: true }
            );
            if (updated && updated.attempts >= MAX_OTP_ATTEMPTS) {
                await OtpVerification.deleteOne({ _id: pending._id });
                throw new Error('Bạn đã nhập sai mã quá số lần cho phép. Vui lòng yêu cầu mã mới.');
            }
            throw invalid();
        }

        // Xoá có điều kiện: chỉ request ĐẦU TIÊN nhận deletedCount = 1,
        // request thứ hai (dùng lại mã / chạy song song) rơi vào nhánh lỗi.
        const consumed = await OtpVerification.deleteOne({ _id: pending._id, otp_code: pending.otp_code });
        if (consumed.deletedCount !== 1) throw invalid();
        return pending;
    }

    static async register(payload: { email: string; password: string; name: string; role?: string }) {
        const email = normalizeEmail(payload?.email);
        const password = assertPassword(payload?.password);
        const name = String(payload?.name || '').trim();
        if (!name) throw new Error('Vui lòng nhập họ tên.');
        // Mặc định BUYER; SELLER được phép tự đăng ký để hệ thống có tài khoản người bán.
        const role = normalizeSignupRole(payload?.role);

        const existing = await User.findOne({ email });
        if (existing) throw new Error('Email đã được sử dụng.');

        const password_hash = await bcrypt.hash(password, 12);

        const otp = generateOtp();
        const expired_at = new Date(Date.now() + OTP_TTL_MS);
        await OtpVerification.deleteMany({ email, purpose: 'REGISTER' });
        await OtpVerification.create({
            email,
            otp_code: otp,
            purpose: 'REGISTER',
            expired_at,
            temp_password_hash: password_hash,
            temp_full_name: name,
            temp_role: role,
            attempts: 0,
        });

        try {
            await sendOtpEmail(email, otp);
        } catch (error: any) {
            logOtpFallback('GỬI EMAIL THẤT BẠI', error, otp);
        }

        return { message: 'Đăng ký thành công. Vui lòng kiểm tra email để lấy mã OTP.', email };
    }

    static async verifyOtp(email: string, code: string) {
        const normalizedEmail = normalizeEmail(email);

        // Kiểm tra trùng email TRƯỚC khi tiêu thụ OTP để không đốt mã một cách vô ích.
        const existing = await User.findOne({ email: normalizedEmail });
        if (existing) throw new Error('Email đã được sử dụng.');

        const record = await this.consumeOtp(normalizedEmail, code, 'REGISTER');

        if (!record.temp_password_hash || !record.temp_full_name) {
            throw new Error('Dữ liệu đăng ký không hợp lệ.');
        }

        const user = await User.create({
            email: normalizedEmail,
            password_hash: record.temp_password_hash,
            full_name: record.temp_full_name,
            role: record.temp_role || 'BUYER',
        });

        // Dọn nốt các mã còn lại của email này (nếu có)
        await OtpVerification.deleteMany({ email: normalizedEmail });

        return authResponse(user);
    }

    static async login(payload: { email: string; password: string }) {
        const email = normalizeEmail(payload?.email);
        const password = String(payload?.password || '');

        const user = await User.findOne({ email });
        if (!user) {
            const pendingReg = await OtpVerification.findOne({ email, purpose: 'REGISTER' });
            if (pendingReg) {
                const err = new Error('Tài khoản chưa được xác thực. Vui lòng xác thực bằng mã OTP.') as any;
                err.code = 'USER_NOT_VERIFIED';
                throw err;
            }
            const err = new Error('Email hoặc mật khẩu không đúng.') as any;
            err.code = 'USER_NOT_FOUND';
            throw err;
        }
        if (user.is_locked) {
            throw new Error('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.');
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            const err = new Error('Email hoặc mật khẩu không đúng.') as any;
            err.code = 'INVALID_PASSWORD';
            throw err;
        }

        return authResponse(user);
    }

    static async googleAuth(accessToken: string) {
        const res = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`);
        if (!res.ok) throw new Error('Token Google không hợp lệ.');
        const gInfo = await res.json() as any;
        if (!gInfo.email) throw new Error('Không lấy được thông tin Google.');

        const email = normalizeEmail(gInfo.email);

        let user = await User.findOne({ email });
        if (!user) {
            const password_hash = await bcrypt.hash(Math.random().toString(36), 12);
            user = await User.create({ email, password_hash, full_name: gInfo.name || email, avatar: gInfo.picture, role: 'BUYER' });
        }
        if (user.is_locked) throw new Error('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.');

        await OtpVerification.deleteMany({ email, purpose: 'REGISTER' });

        return authResponse(user);
    }

    static async resendOtp(email: string) {
        const normalizedEmail = normalizeEmail(email);

        // Ở luồng đăng ký, User CHƯA tồn tại (chỉ được tạo ở verify-otp).
        // Bản cũ đòi User phải tồn tại nên resend-otp luôn hỏng, và mã mới sinh ra
        // cũng mất temp_password_hash/temp_full_name khiến verify-otp không dùng được.
        const pending = await OtpVerification.findOne({ email: normalizedEmail, purpose: 'REGISTER' });

        if (!pending) {
            const user = await User.findOne({ email: normalizedEmail });
            if (user) throw new Error('Tài khoản đã được xác thực. Vui lòng đăng nhập.');
            throw new Error('Không tìm thấy yêu cầu đăng ký cho email này. Vui lòng đăng ký lại.');
        }

        const otp = generateOtp();
        // Cập nhật tại chỗ để GIỮ NGUYÊN temp_password_hash / temp_full_name / temp_role
        pending.otp_code = otp;
        pending.expired_at = new Date(Date.now() + OTP_TTL_MS);
        pending.attempts = 0;
        await pending.save();

        try {
            await sendOtpEmail(normalizedEmail, otp);
        } catch (error: any) {
            logOtpFallback('GỬI EMAIL THẤT BẠI', error, otp);
        }

        return { message: 'Đã gửi lại mã OTP.' };
    }

    static async forgotPassword(email: string) {
        const normalizedEmail = normalizeEmail(email);
        const user = await User.findOne({ email: normalizedEmail });
        if (!user) throw new Error('Email không tồn tại trong hệ thống.');

        const otp = generateOtp();
        const expired_at = new Date(Date.now() + OTP_TTL_MS);
        await OtpVerification.deleteMany({ email: normalizedEmail, purpose: 'FORGOT_PASSWORD' });
        await OtpVerification.create({
            email: normalizedEmail,
            otp_code: otp,
            purpose: 'FORGOT_PASSWORD',
            expired_at,
            attempts: 0,
        });

        try {
            await sendResetPasswordEmail(normalizedEmail, otp);
        } catch (error: any) {
            logOtpFallback('GỬI EMAIL ĐẶT LẠI MẬT KHẨU THẤT BẠI', error, otp);
        }

        return { message: 'Vui lòng kiểm tra email để nhận mã đặt lại mật khẩu.', email: normalizedEmail };
    }

    static async resetPassword(payload: { email: string; code: string; newPassword: string }) {
        const email = normalizeEmail(payload?.email);
        const newPassword = assertPassword(payload?.newPassword);

        const user = await User.findOne({ email });
        if (!user) throw new Error('Tài khoản không tồn tại.');

        // consumeOtp xoá mã ngay khi khớp -> mã reset chỉ dùng được đúng một lần
        await this.consumeOtp(email, payload?.code, 'FORGOT_PASSWORD');

        user.password_hash = await bcrypt.hash(newPassword, 12);
        await user.save();

        // Dọn mọi mã còn lại của email này
        await OtpVerification.deleteMany({ email });

        return { message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.' };
    }

    static async getAllUsers() {
        return User.find({}, { password_hash: 0 }).sort({ created_at: -1 });
    }

    static async toggleLockUser(userId: string) {
        const user = await User.findById(userId);
        if (!user) throw new Error('Không tìm thấy người dùng.');
        user.is_locked = !user.is_locked;
        await user.save();
        return user;
    }
}
