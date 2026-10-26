import crypto from 'crypto';

/**
 * Lấy khóa bí mật chuyên biệt cho KYC (tuyệt đối không dùng chung với JWT secret).
 * Bắt buộc phải có trong Production; trong Development tạo khóa cách ly riêng.
 */
function getKycRawSecret(): string {
    const key = process.env.KYC_ENCRYPTION_KEY;
    if (key && key.trim().length >= 16) {
        return key.trim();
    }
    if (process.env.NODE_ENV === 'production') {
        throw new Error(
            '[CryptoSecurity] Biến môi trường KYC_ENCRYPTION_KEY bắt buộc phải được cấu hình trong môi trường Production (tối thiểu 16 ký tự).'
        );
    }
    return 'vietcraft_dev_isolated_kyc_encryption_key_2026_safe!';
}

export function getKycEncryptionKey(): Buffer {
    return crypto.createHash('sha256').update(getKycRawSecret()).digest();
}

const GCM_ALGORITHM = 'aes-256-gcm';
const GCM_IV_LENGTH = 12; // 12 bytes IV chuẩn cho AES-GCM
const GCM_TAG_LENGTH = 16; // 16 bytes Auth Tag
const LEGACY_CBC_ALGORITHM = 'aes-256-cbc';
const LEGACY_CBC_IV_LENGTH = 16;

/**
 * Kiểm tra file buffer trên đĩa đã được mã hóa chưa (EK2: AES-GCM hoặc EK1: legacy CBC)
 */
export function isBufferEncrypted(buffer: Buffer): boolean {
    if (!buffer || buffer.length < 4) return false;
    const magic = buffer.subarray(0, 4).toString('utf-8');
    return magic === 'EK2:' || magic === 'EK1:';
}

/**
 * Mã hóa chuỗi nhạy cảm (Số CCCD, Số tài khoản ngân hàng) sang dạng gcm:IV:TAG:Ciphertext (hex)
 */
export function encryptField(plaintext: string): string {
    if (!plaintext) return '';
    try {
        const key = getKycEncryptionKey();
        const iv = crypto.randomBytes(GCM_IV_LENGTH);
        const cipher = crypto.createCipheriv(GCM_ALGORITHM, key, iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return `gcm:${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (err: any) {
        throw new Error(`Mã hóa dữ liệu thất bại: ${err.message}`);
    }
}

/**
 * Giải mã chuỗi đã mã hóa.
 * Hỗ trợ định dạng mới gcm:IV:TAG:Ciphertext (AES-GCM) và định dạng cũ IV:Ciphertext (CBC).
 * Nếu dữ liệu bị can thiệp trái phép, ném Exception rõ ràng thay vì trả ciphertext.
 */
export function decryptField(encryptedText: string): string {
    if (!encryptedText) return '';
    const key = getKycEncryptionKey();

    // Định dạng mới AES-256-GCM
    if (encryptedText.startsWith('gcm:')) {
        const parts = encryptedText.split(':');
        if (parts.length !== 4) {
            throw new Error('[CryptoSecurity] Định dạng dữ liệu mã hóa GCM không hợp lệ.');
        }
        const [, ivHex, tagHex, cipherHex] = parts;
        try {
            const iv = Buffer.from(ivHex, 'hex');
            const authTag = Buffer.from(tagHex, 'hex');
            const decipher = crypto.createDecipheriv(GCM_ALGORITHM, key, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (err: any) {
            throw new Error(`[CryptoSecurity] Giải mã dữ liệu thất bại hoặc dữ liệu bị sửa đổi: ${err.message}`);
        }
    }

    // Định dạng cũ AES-256-CBC (iv:ciphertext)
    if (encryptedText.includes(':')) {
        try {
            const [ivHex, cipherHex] = encryptedText.split(':');
            if (!ivHex || !cipherHex) return encryptedText;

            const iv = Buffer.from(ivHex, 'hex');
            const decipher = crypto.createDecipheriv(LEGACY_CBC_ALGORITHM, key, iv);
            let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (err: any) {
            throw new Error(`[CryptoSecurity] Giải mã dữ liệu legacy CBC thất bại: ${err.message}`);
        }
    }

    // Dữ liệu cũ chưa từng mã hóa
    return encryptedText;
}

/**
 * Mã hóa binary buffer (ảnh CCCD/tài liệu KYC) lưu trên đĩa (At-rest Encryption) bằng AES-256-GCM (AEAD).
 * Định dạng: Header 4 bytes 'EK2:' + 12 bytes IV + 16 bytes Auth Tag + Encrypted Data
 */
export function encryptBuffer(buffer: Buffer): Buffer {
    if (!buffer || buffer.length === 0) return buffer;
    const key = getKycEncryptionKey();
    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const cipher = crypto.createCipheriv(GCM_ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from('EK2:'), iv, authTag, ciphertext]);
}

/**
 * Giải mã binary buffer (ảnh CCCD/tài liệu KYC) khi đọc từ đĩa.
 * Hỗ trợ AES-256-GCM ('EK2:'), tương thích ngược AES-256-CBC ('EK1:').
 * Nếu file bị can thiệp trái phép hoặc sai khóa, ném Exception rõ ràng thay vì trả dữ liệu hỏng.
 */
export function decryptBuffer(buffer: Buffer): Buffer {
    if (!buffer || buffer.length < 4) return buffer;
    const magic = buffer.subarray(0, 4).toString('utf-8');

    // Chuẩn hiện đại: AES-256-GCM (AEAD xác thực tính toàn vẹn)
    if (magic === 'EK2:') {
        if (buffer.length < 4 + GCM_IV_LENGTH + GCM_TAG_LENGTH) {
            throw new Error('[CryptoSecurity] Dữ liệu file KYC bị cắt cụt hoặc không hợp lệ.');
        }
        const key = getKycEncryptionKey();
        const iv = buffer.subarray(4, 4 + GCM_IV_LENGTH);
        const authTag = buffer.subarray(4 + GCM_IV_LENGTH, 4 + GCM_IV_LENGTH + GCM_TAG_LENGTH);
        const ciphertext = buffer.subarray(4 + GCM_IV_LENGTH + GCM_TAG_LENGTH);

        try {
            const decipher = crypto.createDecipheriv(GCM_ALGORITHM, key, iv);
            decipher.setAuthTag(authTag);
            return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        } catch (err: any) {
            throw new Error(`[CryptoSecurity] Xác thực tính toàn vẹn file KYC thất bại (AES-GCM AuthTag không khớp hoặc khóa không đúng): ${err.message}`);
        }
    }

    // Tương thích ngược: AES-256-CBC phiên bản trước
    if (magic === 'EK1:') {
        if (buffer.length < 4 + LEGACY_CBC_IV_LENGTH) {
            throw new Error('[CryptoSecurity] Dữ liệu file KYC legacy bị cắt cụt.');
        }
        const key = getKycEncryptionKey();
        const iv = buffer.subarray(4, 4 + LEGACY_CBC_IV_LENGTH);
        const ciphertext = buffer.subarray(4 + LEGACY_CBC_IV_LENGTH);

        try {
            const decipher = crypto.createDecipheriv(LEGACY_CBC_ALGORITHM, key, iv);
            return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        } catch (err: any) {
            throw new Error(`[CryptoSecurity] Giải mã file KYC legacy thất bại: ${err.message}`);
        }
    }

    // File nguyên bản chưa từng được mã hóa (hỗ trợ đọc để nâng cấp di trú)
    return buffer;
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
 * Kiểm tra xem chuỗi có phải đã được mã hóa hay không (AES-256-GCM hoặc AES-256-CBC)
 */
export function isEncryptedField(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (trimmed.startsWith('gcm:')) {
        return /^gcm:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i.test(trimmed);
    }
    return /^[0-9a-f]{32}:[0-9a-f]+$/i.test(trimmed);
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
    const hmac = crypto.createHmac('sha256', getKycRawSecret()).update(payload).digest('hex');
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

        const expectedHmac = crypto.createHmac('sha256', getKycRawSecret()).update(payload).digest('hex');
        return crypto.timingSafeEqual(Buffer.from(receivedHmac), Buffer.from(expectedHmac));
    } catch {
        return false;
    }
}
