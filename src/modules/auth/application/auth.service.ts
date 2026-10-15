import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../../app/config';
import { User } from '../../user/infrastructure/models/user.model';
import { OtpVerification, IOtpVerification } from '../infrastructure/models/otp.model';
import { sendOtpEmail, sendResetPasswordEmail } from '../../../shared/utils/email.service';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const MIN_PASSWORD_LENGTH = 8;
const RESEND_COOLDOWN_MS = 30 * 1000;

export class AuthError extends Error {
    statusCode: number;
    code: string;
    errors?: string[];

    constructor(message: string, statusCode = 400, code = 'AUTH_ERROR', errors?: string[]) {
        super(message);
        this.name = 'AuthError';
        this.statusCode = statusCode;
        this.code = code;
        this.errors = errors;
    }
}

/** Role được phép TỰ đăng ký. ADMIN cố tình không nằm ở đây: không ai tự phong admin. */
const SELF_SIGNUP_ROLES = ['BUYER', 'SELLER'] as const;
type SelfSignupRole = typeof SELF_SIGNUP_ROLES[number];

function generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/** Email luôn được chuẩn hoá về lowercase: nếu không, 'A@x.com' và 'a@x.com'
 *  tạo ra hai tài khoản khác nhau và OTP tra theo email sẽ không khớp. */
export function normalizeEmail(email?: string): string {
    const value = String(email || '').trim().toLowerCase();
    if (!value) {
        throw new AuthError('Vui lòng nhập địa chỉ email.', 400, 'VALIDATION_ERROR');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw new AuthError('Email không đúng định dạng (ví dụ: name@example.com).', 400, 'VALIDATION_ERROR');
    }
    return value;
}

export function assertPassword(password?: string): string {
    const value = String(password || '');
    if (!value) {
        throw new AuthError('Vui lòng nhập mật khẩu.', 400, 'VALIDATION_ERROR');
    }
    if (value.length < MIN_PASSWORD_LENGTH) {
        throw new AuthError(`Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`, 400, 'VALIDATION_ERROR');
    }
    return value;
}

/** Chỉ chấp nhận BUYER/SELLER. Truyền ADMIN (hay gì khác) là lỗi 400, không âm thầm hạ cấp. */
function normalizeSignupRole(role?: string): SelfSignupRole {
    const value = String(role || 'BUYER').trim().toUpperCase();
    if (!SELF_SIGNUP_ROLES.includes(value as SelfSignupRole)) {
        throw new AuthError("Vai trò đăng ký không hợp lệ. Chỉ chấp nhận 'BUYER' hoặc 'SELLER'.", 400, 'VALIDATION_ERROR');
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
        const cleanCode = String(code || '').trim();
        if (!cleanCode) {
            throw new AuthError('Vui lòng nhập mã OTP.', 400, 'VALIDATION_ERROR');
        }
        if (cleanCode.length !== 6) {
            throw new AuthError('Mã OTP phải có đúng 6 chữ số.', 400, 'VALIDATION_ERROR');
        }

        const pending = await OtpVerification.findOne({ email, purpose });
        if (!pending) {
            throw new AuthError('Không tìm thấy yêu cầu xác thực hoặc mã OTP đã hết hạn. Vui lòng bấm gửi lại mã.', 400, 'OTP_NOT_FOUND');
        }

        if (pending.expired_at.getTime() <= Date.now()) {
            await OtpVerification.deleteOne({ _id: pending._id });
            throw new AuthError('Mã OTP đã hết hạn. Vui lòng bấm gửi lại mã mới.', 400, 'OTP_EXPIRED');
        }

        if (pending.otp_code !== cleanCode) {
            const updated = await OtpVerification.findOneAndUpdate(
                { _id: pending._id },
                { $inc: { attempts: 1 } },
                { new: true }
            );
            const currentAttempts = updated?.attempts || 1;
            const remaining = Math.max(0, MAX_OTP_ATTEMPTS - currentAttempts);
            if (currentAttempts >= MAX_OTP_ATTEMPTS) {
                await OtpVerification.deleteOne({ _id: pending._id });
                throw new AuthError('Bạn đã nhập sai mã OTP quá 5 lần. Vui lòng yêu cầu gửi lại mã mới.', 400, 'MAX_ATTEMPTS_EXCEEDED');
            }
            throw new AuthError(`Mã OTP không chính xác. Bạn còn ${remaining} lần thử.`, 400, 'INVALID_OTP');
        }

        // Xoá có điều kiện: chỉ request ĐẦU TIÊN nhận deletedCount = 1,
        // request thứ hai (dùng lại mã / chạy song song) rơi vào nhánh lỗi.
        const consumed = await OtpVerification.deleteOne({ _id: pending._id, otp_code: pending.otp_code });
        if (consumed.deletedCount !== 1) {
            throw new AuthError('Mã OTP này đã được sử dụng. Vui lòng yêu cầu mã mới.', 400, 'OTP_ALREADY_USED');
        }
        return pending;
    }

    static async register(payload: { email: string; password: string; name: string; role?: string }) {
        const rawName = String(payload?.name || '').trim();
        if (!rawName) {
            throw new AuthError('Vui lòng nhập họ và tên.', 400, 'VALIDATION_ERROR');
        }
        if (rawName.length < 2) {
            throw new AuthError('Họ và tên phải có ít nhất 2 ký tự.', 400, 'VALIDATION_ERROR');
        }

        const email = normalizeEmail(payload?.email);
        const password = assertPassword(payload?.password);
        const role = normalizeSignupRole(payload?.role);

        const existing = await User.findOne({ email });
        if (existing) {
            throw new AuthError('Email này đã được sử dụng để đăng ký tài khoản. Vui lòng đăng nhập hoặc dùng email khác.', 400, 'EMAIL_ALREADY_EXISTS');
        }

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
            temp_full_name: rawName,
            temp_role: role,
            attempts: 0,
        });

        try {
            await sendOtpEmail(email, otp);
        } catch (error: any) {
            logOtpFallback('GỬI EMAIL THẤT BẠI', error, otp);
        }

        return { message: 'Đăng ký thành công. Vui lòng kiểm tra email để lấy mã xác thực OTP.', email };
    }

    static async verifyOtp(email: string, code: string) {
        const normalizedEmail = normalizeEmail(email);
        const cleanCode = String(code || '').trim();

        if (!cleanCode) {
            throw new AuthError('Vui lòng nhập mã OTP.', 400, 'VALIDATION_ERROR');
        }
        if (cleanCode.length !== 6) {
            throw new AuthError('Mã OTP phải có đúng 6 chữ số.', 400, 'VALIDATION_ERROR');
        }

        // Kiểm tra trùng email TRƯỚC khi tiêu thụ OTP để không đốt mã một cách vô ích.
        const existing = await User.findOne({ email: normalizedEmail });
        if (existing) {
            throw new AuthError('Tài khoản đã được xác thực trước đó. Vui lòng chuyển sang trang đăng nhập.', 400, 'ALREADY_VERIFIED');
        }

        const record = await this.consumeOtp(normalizedEmail, cleanCode, 'REGISTER');

        if (!record.temp_password_hash || !record.temp_full_name) {
            throw new AuthError('Dữ liệu đăng ký không hợp lệ hoặc đã bị xóa. Vui lòng đăng ký lại từ đầu.', 400, 'INVALID_REGISTRATION_DATA');
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
        const rawEmail = String(payload?.email || '').trim();
        const rawPassword = String(payload?.password || '');

        if (!rawEmail) {
            throw new AuthError('Vui lòng nhập địa chỉ email.', 400, 'VALIDATION_ERROR');
        }
        if (!rawPassword) {
            throw new AuthError('Vui lòng nhập mật khẩu.', 400, 'VALIDATION_ERROR');
        }

        const email = normalizeEmail(rawEmail);

        const user = await User.findOne({ email });
        if (!user) {
            const pendingReg = await OtpVerification.findOne({ email, purpose: 'REGISTER' });
            if (pendingReg) {
                throw new AuthError('Tài khoản chưa được kích hoạt. Vui lòng xác thực bằng mã OTP.', 401, 'USER_NOT_VERIFIED');
            }
            throw new AuthError('Email hoặc mật khẩu không chính xác.', 401, 'USER_NOT_FOUND');
        }

        if (user.is_locked) {
            throw new AuthError('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.', 403, 'ACCOUNT_LOCKED');
        }

        const valid = await bcrypt.compare(rawPassword, user.password_hash);
        if (!valid) {
            throw new AuthError('Mật khẩu không chính xác.', 401, 'INVALID_PASSWORD');
        }

        return authResponse(user);
    }

    static async googleAuth(accessToken: string) {
        if (!accessToken || !String(accessToken).trim()) {
            throw new AuthError('Thiếu access token Google.', 400, 'VALIDATION_ERROR');
        }

        let res: globalThis.Response;
        try {
            res = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`);
        } catch {
            throw new AuthError('Không thể kết nối đến máy chủ Google để xác thực tài khoản.', 400, 'GOOGLE_CONNECTION_ERROR');
        }

        if (!res.ok) {
            throw new AuthError('Phiên đăng nhập Google đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.', 401, 'INVALID_GOOGLE_TOKEN');
        }

        const gInfo = (await res.json()) as any;
        if (!gInfo?.email) {
            throw new AuthError('Không lấy được thông tin email từ tài khoản Google.', 400, 'GOOGLE_NO_EMAIL');
        }

        const email = normalizeEmail(gInfo.email);

        let user = await User.findOne({ email });
        if (!user) {
            const password_hash = await bcrypt.hash(Math.random().toString(36), 12);
            user = await User.create({ email, password_hash, full_name: gInfo.name || email, avatar: gInfo.picture, role: 'BUYER' });
        }

        if (user.is_locked) {
            throw new AuthError('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.', 403, 'ACCOUNT_LOCKED');
        }

        await OtpVerification.deleteMany({ email, purpose: 'REGISTER' });

        return authResponse(user);
    }

    static async resendOtp(email: string) {
        const normalizedEmail = normalizeEmail(email);

        const pending = await OtpVerification.findOne({ email: normalizedEmail, purpose: 'REGISTER' });

        if (!pending) {
            const user = await User.findOne({ email: normalizedEmail });
            if (user) {
                throw new AuthError('Tài khoản này đã được xác thực trước đó. Vui lòng đăng nhập.', 400, 'ALREADY_VERIFIED');
            }
            throw new AuthError('Không tìm thấy yêu cầu đăng ký cho email này. Vui lòng đăng ký lại tài khoản.', 400, 'REGISTRATION_NOT_FOUND');
        }

        // Chống spam: Cooldown giữa các lần gửi lại
        const lastUpdated = pending.get('updated_at') as Date;
        if (lastUpdated && Date.now() - new Date(lastUpdated).getTime() < RESEND_COOLDOWN_MS) {
            const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - new Date(lastUpdated).getTime())) / 1000);
            throw new AuthError(`Vui lòng đợi ${waitSeconds} giây trước khi yêu cầu gửi lại mã OTP mới.`, 429, 'RATE_LIMITED');
        }

        const otp = generateOtp();
        pending.otp_code = otp;
        pending.expired_at = new Date(Date.now() + OTP_TTL_MS);
        pending.attempts = 0;
        await pending.save();

        try {
            await sendOtpEmail(normalizedEmail, otp);
        } catch (error: any) {
            logOtpFallback('GỬI EMAIL THẤT BẠI', error, otp);
        }

        return { message: 'Đã gửi lại mã OTP mới. Vui lòng kiểm tra hộp thư của bạn.' };
    }

    static async forgotPassword(email: string) {
        const normalizedEmail = normalizeEmail(email);
        const user = await User.findOne({ email: normalizedEmail });
        if (!user) {
            throw new AuthError('Email này không tồn tại trong hệ thống. Vui lòng kiểm tra lại hoặc tạo tài khoản mới.', 404, 'USER_NOT_FOUND');
        }
        if (user.is_locked) {
            throw new AuthError('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.', 403, 'ACCOUNT_LOCKED');
        }

        // Cooldown check
        const pending = await OtpVerification.findOne({ email: normalizedEmail, purpose: 'FORGOT_PASSWORD' });
        if (pending) {
            const lastUpdated = pending.get('updated_at') as Date;
            if (lastUpdated && Date.now() - new Date(lastUpdated).getTime() < RESEND_COOLDOWN_MS) {
                const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - new Date(lastUpdated).getTime())) / 1000);
                throw new AuthError(`Vui lòng đợi ${waitSeconds} giây trước khi yêu cầu gửi mã mới.`, 429, 'RATE_LIMITED');
            }
        }

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

        return { message: 'Mã xác thực đặt lại mật khẩu đã được gửi đến email của bạn.', email: normalizedEmail };
    }

    static async resetPassword(payload: { email: string; code: string; newPassword: string }) {
        const email = normalizeEmail(payload?.email);
        const code = String(payload?.code || '').trim();
        if (!code) {
            throw new AuthError('Vui lòng nhập mã OTP xác thực.', 400, 'VALIDATION_ERROR');
        }
        if (code.length !== 6) {
            throw new AuthError('Mã OTP phải có đúng 6 chữ số.', 400, 'VALIDATION_ERROR');
        }

        const newPassword = assertPassword(payload?.newPassword);

        const user = await User.findOne({ email });
        if (!user) {
            throw new AuthError('Tài khoản không tồn tại trong hệ thống.', 404, 'USER_NOT_FOUND');
        }
        if (user.is_locked) {
            throw new AuthError('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.', 403, 'ACCOUNT_LOCKED');
        }

        // consumeOtp xoá mã ngay khi khớp -> mã reset chỉ dùng được đúng một lần
        await this.consumeOtp(email, code, 'FORGOT_PASSWORD');

        user.password_hash = await bcrypt.hash(newPassword, 12);
        await user.save();

        // Dọn mọi mã còn lại của email này
        await OtpVerification.deleteMany({ email });

        return { message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.' };
    }

    static async getAllUsers() {
        return User.find({}, { password_hash: 0 }).sort({ created_at: -1 });
    }

    static async toggleLockUser(userId: string) {
        const user = await User.findById(userId);
        if (!user) {
            throw new AuthError('Không tìm thấy người dùng.', 404, 'USER_NOT_FOUND');
        }
        user.is_locked = !user.is_locked;
        await user.save();
        return user;
    }
}
