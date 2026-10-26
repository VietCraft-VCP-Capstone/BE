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

export async function sendPhoneVerificationOtpEmail(to: string, phone: string, otp: string) {
    try {
        await transporter.sendMail({
            from: `"VietCraft" <${config.mailUser}>`,
            to,
            subject: `[VietCraft] Mã xác thực OTP số điện thoại: ${otp}`,
            html: `
                <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;background:#ffffff">
                    <div style="text-align:center;margin-bottom:20px">
                        <h1 style="color:#007700;margin:0;font-size:26px">Viet<span style="color:#330033">Craft</span></h1>
                        <span style="display:inline-block;margin-top:6px;padding:3px 12px;background:#ecfdf5;color:#047857;border-radius:16px;font-size:12px;font-weight:bold">XÁC THỰC SỐ ĐIỆN THOẠI NGƯỜI BÁN (KYC)</span>
                    </div>
                    <h3 style="color:#111827;margin:0 0 12px">Xác nhận số điện thoại di động</h3>
                    <p style="color:#4b5563;line-height:1.6;margin:0 0 16px">
                        Bạn đang thực hiện xác thực số điện thoại <strong>${phone}</strong> trong quy trình định danh (KYC) mở gian hàng Người bán trên VietCraft.
                    </p>
                    <p style="color:#6b7280;margin:0 0 12px;font-size:13px">Mã OTP xác thực của bạn có hiệu lực trong <strong>5 phút</strong>:</p>
                    <div style="background:#f0fdf4;border:2px dashed #007700;border-radius:10px;padding:18px;text-align:center;font-size:36px;font-weight:bold;letter-spacing:10px;color:#007700;margin-bottom:20px">${otp}</div>
                    <p style="color:#9ca3af;font-size:12px;margin:0;line-height:1.5">
                        Lưu ý: Nếu hệ thống chưa kết nối SMS Gateway nhà mạng, mã này được gửi an toàn về email đã đăng ký của bạn để phục vụ kiểm thử và xác nhận. Vui lòng không chia sẻ mã OTP với bất kỳ ai.
                    </p>
                </div>
            `,
        });
    } catch (err: any) {
        console.warn('⚠️ Lỗi gửi email OTP số điện thoại:', err?.message);
    }
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

export async function sendSellerApprovalEmail(to: string, shopName: string, sellerName: string) {
    await transporter.sendMail({
        from: `"VietCraft" <${config.mailUser}>`,
        to,
        subject: '🎉 Chúc mừng! Hồ sơ Người bán VietCraft của bạn đã được phê duyệt',
        html: `
            <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;background:#ffffff">
                <div style="text-align:center;margin-bottom:20px">
                    <h1 style="color:#007700;margin:0;font-size:28px">Viet<span style="color:#330033">Craft</span></h1>
                    <span style="display:inline-block;margin-top:8px;padding:4px 12px;background:#ecfdf5;color:#047857;border-radius:20px;font-size:12px;font-weight:bold">HỒ SƠ ĐÃ ĐƯỢC PHÊ DUYỆT</span>
                </div>
                <h3 style="color:#111827;margin:0 0 12px">Xin chào ${sellerName},</h3>
                <p style="color:#4b5563;line-height:1.6;margin:0 0 16px">
                    Hồ sơ định danh (KYC) và thông tin mở gian hàng <strong>${shopName}</strong> của bạn đã được Quản trị viên VietCraft phê duyệt thành công.
                </p>
                <div style="background:#f9fafb;border:1px solid #f3f4f6;border-radius:8px;padding:16px;margin-bottom:24px">
                    <p style="margin:0 0 8px;font-size:13px;color:#374151"><strong>Tên gian hàng:</strong> ${shopName}</p>
                    <p style="margin:0 0 8px;font-size:13px;color:#374151"><strong>Trạng thái:</strong> Đang hoạt động (Kích hoạt đầy đủ quyền Người bán)</p>
                    <p style="margin:0;font-size:13px;color:#374151"><strong>Phân quyền:</strong> SELLER</p>
                </div>
                <div style="text-align:center;margin-bottom:24px">
                    <a href="${config.frontendUrl}/seller/dashboard" style="display:inline-block;background:#007700;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:14px">
                        Truy cập Kênh Người Bán
                    </a>
                </div>
                <p style="color:#9ca3af;font-size:12px;margin:0;text-align:center">Cảm ơn bạn đã đồng hành cùng cộng đồng thủ công mỹ nghệ Việt Nam!</p>
            </div>
        `,
    });
}

export async function sendSellerRejectionEmail(to: string, shopName: string, sellerName: string, reason: string) {
    await transporter.sendMail({
        from: `"VietCraft" <${config.mailUser}>`,
        to,
        subject: 'Thông báo về hồ sơ đăng ký Người bán VietCraft',
        html: `
            <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px;border:1px solid #fee2e2;border-radius:12px;background:#ffffff">
                <div style="text-align:center;margin-bottom:20px">
                    <h1 style="color:#007700;margin:0;font-size:28px">Viet<span style="color:#330033">Craft</span></h1>
                    <span style="display:inline-block;margin-top:8px;padding:4px 12px;background:#fef2f2;color:#b91c1c;border-radius:20px;font-size:12px;font-weight:bold">CẦN CẬP NHẬT HỒ SƠ</span>
                </div>
                <h3 style="color:#111827;margin:0 0 12px">Xin chào ${sellerName},</h3>
                <p style="color:#4b5563;line-height:1.6;margin:0 0 16px">
                    Rất tiếc, hồ sơ đăng ký Người bán cho gian hàng <strong>${shopName}</strong> chưa thể phê duyệt do chưa đáp ứng một số tiêu chí theo quy định.
                </p>
                <div style="background:#fff1f2;border-left:4px solid #e11d48;padding:16px;margin-bottom:24px;border-radius:4px">
                    <p style="margin:0 0 4px;font-size:12px;font-weight:bold;color:#9f1239">LÝ DO TỪ CHỐI TỪ QUẢN TRỊ VIÊN:</p>
                    <p style="margin:0;font-size:14px;color:#881337;line-height:1.5">${reason || 'Thông tin hoặc hình ảnh định danh chưa đạt chuẩn theo quy định.'}</p>
                </div>
                <div style="text-align:center;margin-bottom:24px">
                    <a href="${config.frontendUrl}/seller/register" style="display:inline-block;background:#330033;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:14px">
                        Cập nhật lại hồ sơ
                    </a>
                </div>
                <p style="color:#9ca3af;font-size:12px;margin:0;text-align:center">Nếu có thắc mắc, vui lòng liên hệ bộ phận hỗ trợ đối tác của VietCraft.</p>
            </div>
        `,
    });
}

// Tên và tiêu đề sản phẩm do shop khác tự đặt: phải escape trước khi chèn vào HTML email.
function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

export async function sendCompetitorAlertEmail(to: string, items: { title: string; content: string }[], link: string) {
    const rows = items.map(item => `
                <li style="margin:0 0 12px">
                    <strong style="color:#111827">${escapeHtml(item.title)}</strong><br>
                    <span style="color:#4b5563">${escapeHtml(item.content)}</span>
                </li>`).join('');
    await transporter.sendMail({
        from: `"VietCraft" <${config.mailUser}>`,
        to,
        subject: `VietCraft: ${items.length} sản phẩm mới của đối thủ bạn đang theo dõi`,
        html: `
            <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px">
                <h2 style="color:#007700;margin:0 0 8px">VietCraft</h2>
                <h3 style="color:#330033;margin:0 0 16px">Đối thủ vừa ra hàng mới trong nhóm hàng của bạn</h3>
                <ul style="padding-left:18px;margin:0 0 24px;line-height:1.5">${rows}
                </ul>
                <a href="${link}" style="display:inline-block;background:#007700;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:14px">
                    Xem trong trang Phân tích đối thủ
                </a>
                <p style="color:#9ca3af;font-size:12px;margin:24px 0 0">Bạn nhận email này vì đang theo dõi các shop trên. Tắt email thông báo trong phần cài đặt tài khoản.</p>
            </div>
        `,
    });
}
