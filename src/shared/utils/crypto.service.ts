import crypto from 'crypto';
import { config } from '../../app/config';

const RAW_SECRET = process.env.KYC_ENCRYPTION_KEY || config.jwtSecret || '';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(RAW_SECRET).digest();
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Mã hóa chuỗi nhạy cảm (Số CCCD, Số tài khoản ngân hàng) sang dạng IV:Ciphertext (hex)
 */
export function encryptField(plaintext: string): string {
    if (!plaintext) return '';
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return `${iv.toString('hex')}:${encrypted}`;
    } catch (err: any) {
        throw new Error(`Mã hóa dữ liệu thất bại: ${err.message}`);
    }
}

/**
 * Giải mã chuỗi đã mã hóa dạng IV:Ciphertext
 */
export function decryptField(encryptedText: string): string {
    if (!encryptedText) return '';
    // Nếu dữ liệu không theo định dạng iv:cipher (dữ liệu cũ/chưa mã hóa), trả lại nguyên bản
    if (!encryptedText.includes(':')) return encryptedText;

    try {
        const [ivHex, cipherHex] = encryptedText.split(':');
        if (!ivHex || !cipherHex) return encryptedText;

        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err: any) {
        return '***LỖI_GIẢI_MÃ***';
    }
}

/**
 * Che số CCCD/CMND (chỉ hiển thị 3 số đầu và 3 số cuối)
 * Ví dụ: 079200001234 -> 079******234
 */
export function maskCardNumber(cardNumber: string): string {
    const raw = String(cardNumber || '').trim();
    if (raw.length <= 6) return raw;
    const start = raw.slice(0, 3);
    const end = raw.slice(-3);
    const middle = '*'.repeat(Math.max(raw.length - 6, 4));
    return `${start}${middle}${end}`;
}

/**
 * Kiểm tra xem chuỗi có phải đã được mã hóa bằng AES-256-CBC (dạng IV_HEX:CIPHER_HEX) hay không
 */
export function isEncryptedField(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    return /^[0-9a-f]{32}:[0-9a-f]+$/i.test(text.trim());
}

/**
 * Che số tài khoản ngân hàng (chỉ hiển thị 4 số cuối chuẩn **** **** 1234)
 * Ví dụ: 1903456789012 -> **** **** 9012
 */
export function maskBankAccount(accountNumber: string): string {
    const raw = String(accountNumber || '').trim();
    if (!raw) return '';
    if (raw.startsWith('*')) return raw;
    if (raw.length <= 4) return `**** ${raw}`;
    const end = raw.slice(-4);
    return `**** **** ${end}`;
}

/**
 * Che khóa bí mật API Key của đối tác (xưởng in POD, gateway)
 * Giữ tiền tố nhận diện (ví dụ psk_live_...) và đuôi xác minh, ẩn phần bí mật ở giữa
 * Ví dụ: psk_live_3df21038ba98c8bff8b -> psk_live_3df...8bff8b
 */
export function maskApiKey(apiKey: string): string {
    const raw = String(apiKey || '').trim();
    if (!raw) return '';
    if (raw.includes('...')) return raw;
    if (raw.length <= 10) return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
    const prefix = raw.slice(0, Math.min(12, Math.floor(raw.length / 3)));
    const suffix = raw.slice(-Math.min(6, Math.floor(raw.length / 4)));
    return `${prefix}...${suffix}`;
}

/**
 * Chuẩn hóa tên Tiếng Việt: bỏ dấu, viết hoa, xóa khoảng trắng thừa
 * Ví dụ: "Nguyễn   Văn  A " -> "NGUYEN VAN A"
 */
export function normalizeVietnameseName(str: string): string {
    if (!str) return '';
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * So sánh đối soát xem tên chủ tài khoản có khớp với tên trên CCCD hoặc Giấy phép kinh doanh không
 */
export function areNamesMatching(nameA: string, nameB: string): boolean {
    const cleanA = normalizeVietnameseName(nameA);
    const cleanB = normalizeVietnameseName(nameB);
    if (!cleanA || !cleanB) return false;
    return cleanA === cleanB;
}

/**
 * Tạo token ký HMAC cho presigned URL xem ảnh bảo mật (thời hạn mặc định 10 phút)
 */
export function generatePresignedToken(filename: string, expiresInSeconds: number = 600): { token: string; expiresAt: number } {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const payload = `${filename}:${expiresAt}`;
    const hmac = crypto.createHmac('sha256', RAW_SECRET).update(payload).digest('hex');
    const token = `${Buffer.from(payload).toString('base64url')}.${hmac}`;
    return { token, expiresAt };
}

/**
 * Xác minh presigned token xem ảnh
 */
export function verifyPresignedToken(filename: string, token: string): boolean {
    try {
        const [encodedPayload, receivedHmac] = token.split('.');
        if (!encodedPayload || !receivedHmac) return false;

        const payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
        const [tokenFilename, expiresAtStr] = payload.split(':');
        if (tokenFilename !== filename) return false;

        const expiresAt = parseInt(expiresAtStr, 10);
        if (isNaN(expiresAt) || Math.floor(Date.now() / 1000) > expiresAt) {
            return false; // Đã hết hạn
        }

        const expectedHmac = crypto.createHmac('sha256', RAW_SECRET).update(payload).digest('hex');
        return crypto.timingSafeEqual(Buffer.from(receivedHmac), Buffer.from(expectedHmac));
    } catch {
        return false;
    }
}
