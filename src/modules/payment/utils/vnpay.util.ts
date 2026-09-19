import crypto from 'crypto';

/**
 * Format Date thành YYYYMMDDHHmmss theo múi giờ Việt Nam (GMT+7)
 */
export function formatVnpayDate(date: Date = new Date()): string {
    const tzOffset = 7 * 60; // GMT+7 tính bằng phút
    const localTime = new Date(date.getTime() + (tzOffset + date.getTimezoneOffset()) * 60000);

    const year = localTime.getFullYear();
    const month = String(localTime.getMonth() + 1).padStart(2, '0');
    const day = String(localTime.getDate()).padStart(2, '0');
    const hours = String(localTime.getHours()).padStart(2, '0');
    const minutes = String(localTime.getMinutes()).padStart(2, '0');
    const seconds = String(localTime.getSeconds()).padStart(2, '0');

    return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * Sắp xếp các key của Object theo thứ tự alphabet A-Z chuẩn hóa cho VNPay
 */
export function sortObject(obj: Record<string, any>): Record<string, string> {
    const sorted: Record<string, string> = {};
    const keys = Object.keys(obj).sort();

    for (const key of keys) {
        const val = obj[key];
        if (val !== undefined && val !== null && val !== '') {
            // Encode đúng chuẩn RFC 3986 và thay thế %20 bằng +
            sorted[encodeURIComponent(key)] = encodeURIComponent(String(val)).replace(/%20/g, '+');
        }
    }
    return sorted;
}

/**
 * Nối các tham số đã sắp xếp thành query string (key=value&key2=value2)
 */
export function stringifyParams(sorted: Record<string, string>): string {
    return Object.entries(sorted)
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
}

/**
 * Tạo mã băm HMAC SHA512
 */
export function createHmacSha512(secretKey: string, data: string): string {
    return crypto.createHmac('sha512', secretKey).update(Buffer.from(data, 'utf-8')).digest('hex');
}
