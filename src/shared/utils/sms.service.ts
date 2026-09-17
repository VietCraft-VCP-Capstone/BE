import { config } from '../../app/config';
import { logger } from './logger';

export interface SendSmsResult {
    success: boolean;
    message: string;
    data?: any;
    provider?: string;
}

export class SmsService {
    /**
     * Chuẩn hoá số điện thoại sang định dạng di động quốc tế hoặc SpeedSMS (84xxxxxxxxx)
     */
    static normalizePhoneNumber(phone: string): string {
        let clean = String(phone || '').replace(/\D/g, '');
        if (clean.startsWith('84')) {
            return clean;
        }
        if (clean.startsWith('0')) {
            return '84' + clean.slice(1);
        }
        return clean;
    }

    /**
     * Gửi tin nhắn SMS OTP thực tế tới số điện thoại người dùng qua SpeedSMS Gateway
     */
    static async sendOtp(rawPhone: string, otp: string): Promise<SendSmsResult> {
        const phone = this.normalizePhoneNumber(rawPhone);
        const token = config.speedSmsAccessToken || process.env.SPEEDSMS_ACCESS_TOKEN;

        if (!token) {
            logger.warn('⚠️ SPEEDSMS_ACCESS_TOKEN chưa được cấu hình trong .env');
            return {
                success: false,
                message: 'Cổng gửi tin nhắn SMS chưa được cấu hình API Key trong file .env.',
                provider: 'speedsms'
            };
        }

        const smsType = Number(process.env.SPEEDSMS_SMS_TYPE) || 2;
        const sender = process.env.SPEEDSMS_SENDER || '';
        const content = `[VietCraft] Ma xac thuc OTP cua ban la: ${otp}. Ma co hieu luc trong 5 phut.`;

        const authHeader = 'Basic ' + Buffer.from(`${token}:x`).toString('base64');
        const payload: any = {
            to: [phone],
            content: content,
            sms_type: smsType,
        };
        if (sender) {
            payload.sender = sender;
        }

        try {
            logger.info(`📡 Đang gửi SMS thật qua SpeedSMS tới số: ${phone} (sms_type: ${smsType}, sender: "${sender || 'mặc định'}")`);

            const response = await fetch('https://api.speedsms.vn/index.php/sms/send', {
                method: 'POST',
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const result: any = await response.json();

            if (result && (result.status === 'success' || result.code === '00' || result.code === 0)) {
                logger.info(`✅ Gửi SMS thành công qua SpeedSMS tới ${phone}:`, result);
                return {
                    success: true,
                    message: `Tin nhắn SMS chứa mã OTP đã được gửi thành công đến số điện thoại của bạn.`,
                    data: result,
                    provider: 'speedsms'
                };
            }

            logger.warn(`⚠️ SpeedSMS trả lời lỗi:`, result);
            return {
                success: false,
                message: result?.message || 'Gửi SMS thất bại từ cổng SpeedSMS.',
                data: result,
                provider: 'speedsms'
            };
        } catch (error: any) {
            logger.error(`❌ Lỗi kết nối đến cổng SpeedSMS:`, error?.message);
            return {
                success: false,
                message: `Lỗi kết nối nhà mạng viễn thông: ${error?.message}`,
                provider: 'speedsms'
            };
        }
    }
}
