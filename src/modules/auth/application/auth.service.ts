import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../../app/config';
import { User } from '../../user/infrastructure/models/user.model';
import { OtpVerification } from '../infrastructure/models/otp.model';
import { sendOtpEmail, sendResetPasswordEmail } from '../../../shared/utils/email.service';

function generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(payload: { id: string; email: string; role: string }) {
    return jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });
}

export class AuthService {
    static async register(payload: { email: string; password: string; name: string }) {
        const { email, password, name } = payload;

        const existing = await User.findOne({ email });
        if (existing) throw new Error('Email đã được sử dụng.');

        const password_hash = await bcrypt.hash(password, 12);

        const otp = generateOtp();
        const expired_at = new Date(Date.now() + 10 * 60 * 1000);
        await OtpVerification.deleteMany({ email, purpose: 'REGISTER' });
        await OtpVerification.create({
            email,
            otp_code: otp,
            purpose: 'REGISTER',
            expired_at,
            temp_password_hash: password_hash,
            temp_full_name: name,
        });

        try {
            await sendOtpEmail(email, otp);
        } catch (error: any) {
            console.warn('\n\n==================================================');
            console.warn('⚠️ GỬI EMAIL THẤT BẠI:', error.message);
            console.warn(`🔥 MÃ OTP CỦA BẠN (LẤY Ở ĐÂY ĐỂ ĐĂNG KÝ): ${otp}`);
            console.warn('==================================================\n');
        }

        return { message: 'Đăng ký thành công. Vui lòng kiểm tra email để lấy mã OTP.', email };
    }

    static async verifyOtp(email: string, code: string) {
        const record = await OtpVerification.findOne({
            email,
            otp_code: code,
            purpose: 'REGISTER',
            expired_at: { $gt: new Date() },
        });
        if (!record) throw new Error('Mã OTP không hợp lệ hoặc đã hết hạn.');

        const existing = await User.findOne({ email });
        if (existing) throw new Error('Email đã được sử dụng.');

        if (!record.temp_password_hash || !record.temp_full_name) {
            throw new Error('Dữ liệu đăng ký không hợp lệ.');
        }

        const user = await User.create({
            email,
            password_hash: record.temp_password_hash,
            full_name: record.temp_full_name,
            role: 'BUYER',
        });

        await OtpVerification.deleteMany({ email });

        const token = generateToken({ id: user._id.toString(), email: user.email, role: user.role });
        return { token, user: { id: user._id, email: user.email, name: user.full_name, role: user.role } };
    }

    static async login(payload: { email: string; password: string }) {
        const { email, password } = payload;
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

        const token = generateToken({ id: user._id.toString(), email: user.email, role: user.role });
        return { token, user: { id: user._id, email: user.email, name: user.full_name, role: user.role } };
    }

    static async googleAuth(accessToken: string) {
        const res = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`);
        if (!res.ok) throw new Error('Token Google không hợp lệ.');
        const gInfo = await res.json() as any;
        if (!gInfo.email) throw new Error('Không lấy được thông tin Google.');

        let user = await User.findOne({ email: gInfo.email });
        if (!user) {
            const password_hash = await bcrypt.hash(Math.random().toString(36), 12);
            user = await User.create({ email: gInfo.email, password_hash, full_name: gInfo.name || gInfo.email, avatar: gInfo.picture, role: 'BUYER' });
        }
        if (user.is_locked) throw new Error('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.');

        await OtpVerification.deleteMany({ email: gInfo.email, purpose: 'REGISTER' });

        const token = generateToken({ id: user._id.toString(), email: user.email, role: user.role });
        return { token, user: { id: user._id, email: user.email, name: user.full_name, role: user.role } };
    }

    static async resendOtp(email: string) {
        const user = await User.findOne({ email });
        if (!user) throw new Error('Email không tồn tại.');

        const otp = generateOtp();
        const expired_at = new Date(Date.now() + 10 * 60 * 1000);
        await OtpVerification.deleteMany({ email });
        await OtpVerification.create({ email, otp_code: otp, purpose: 'REGISTER', expired_at });

        try {
            await sendOtpEmail(email, otp);
        } catch (error: any) {
            console.warn('\n\n==================================================');
            console.warn('⚠️ GỬI EMAIL THẤT BẠI:', error.message);
            console.warn(`🔥 MÃ OTP CỦA BẠN (LẤY Ở ĐÂY ĐỂ ĐĂNG KÝ): ${otp}`);
            console.warn('==================================================\n');
        }

        return { message: 'Đã gửi lại mã OTP.' };
    }

    static async forgotPassword(email: string) {
        const user = await User.findOne({ email });
        if (!user) throw new Error('Email không tồn tại trong hệ thống.');

        const otp = generateOtp();
        const expired_at = new Date(Date.now() + 10 * 60 * 1000);
        await OtpVerification.deleteMany({ email, purpose: 'FORGOT_PASSWORD' });
        await OtpVerification.create({ email, otp_code: otp, purpose: 'FORGOT_PASSWORD', expired_at });

        try {
            await sendResetPasswordEmail(email, otp);
        } catch (error: any) {
            console.warn('\n\n==================================================');
            console.warn('⚠️ GỬI EMAIL ĐẶT LẠI MẬT KHẨU THẤT BẠI:', error.message);
            console.warn(`🔥 MÃ OTP CỦA BẠN (LẤY ĐỂ ĐẶT LẠI MẬT KHẨU): ${otp}`);
            console.warn('==================================================\n');
        }

        return { message: 'Vui lòng kiểm tra email để nhận mã đặt lại mật khẩu.', email };
    }

    static async resetPassword(payload: { email: string; code: string; newPassword: string }) {
        const { email, code, newPassword } = payload;

        const record = await OtpVerification.findOne({
            email,
            otp_code: code,
            purpose: 'FORGOT_PASSWORD',
            expired_at: { $gt: new Date() },
        });
        if (!record) throw new Error('Mã OTP không hợp lệ hoặc đã hết hạn.');

        const user = await User.findOne({ email });
        if (!user) throw new Error('Tài khoản không tồn tại.');

        const password_hash = await bcrypt.hash(newPassword, 12);
        user.password_hash = password_hash;
        await user.save();

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
