import nodemailer from 'nodemailer';
import { config } from '../../app/config';

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: config.mailUser,
        pass: config.mailPass,
    },
});

export async function sendOtpEmail(to: string, otp: string) {
    await transporter.sendMail({
        from: `"VietCraft" <${config.mailUser}>`,
        to,
        subject: 'Mã xác thực VietCraft của bạn',
        html: `
            <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px">
                <h2 style="color:#007700;margin:0 0 8px">VietCraft</h2>
                <h3 style="color:#330033;margin:0 0 16px">Mã xác thực của bạn</h3>
                <p style="color:#6b7280;margin:0 0 24px">Nhập mã OTP dưới đây để xác thực tài khoản. Mã có hiệu lực trong <strong>10 phút</strong>.</p>
                <div style="background:#f3f4f6;border-radius:8px;padding:20px;text-align:center;font-size:36px;font-weight:bold;letter-spacing:12px;color:#330033">${otp}</div>
                <p style="color:#9ca3af;font-size:12px;margin:24px 0 0">Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email.</p>
            </div>
        `,
    });
}

export async function sendResetPasswordEmail(to: string, otp: string) {
    await transporter.sendMail({
        from: `"VietCraft" <${config.mailUser}>`,
        to,
        subject: 'Đặt lại mật khẩu VietCraft của bạn',
        html: `
            <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px">
                <h2 style="color:#007700;margin:0 0 8px">VietCraft</h2>
                <h3 style="color:#330033;margin:0 0 16px">Mã đặt lại mật khẩu của bạn</h3>
                <p style="color:#6b7280;margin:0 0 24px">Nhập mã OTP dưới đây để xác thực đặt lại mật khẩu tài khoản. Mã có hiệu lực trong <strong>10 phút</strong>.</p>
                <div style="background:#f3f4f6;border-radius:8px;padding:20px;text-align:center;font-size:36px;font-weight:bold;letter-spacing:12px;color:#330033">${otp}</div>
                <p style="color:#9ca3af;font-size:12px;margin:24px 0 0">Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>
            </div>
        `,
    });
}
