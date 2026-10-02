/**
 * Dựng payload EMVCo / Napas VietQR (chuyển khoản tới tài khoản, "QRIBFTTA") cho QR hoàn tiền
 * thủ công. FE render QR từ chuỗi này, không phụ thuộc img.vietqr.io.
 *
 *   00 02 01                    payload format indicator
 *   01 02 12                    point of initiation: dynamic
 *   38 LL [00 06 A000000727]    Napas GUID
 *         [01 LL [00 06 bin][01 LL account]]
 *         [02 08 QRIBFTTA]
 *   53 03 704                   VND
 *   54 LL amount                bỏ qua khi amount <= 0
 *   58 02 VN
 *   62 LL [08 LL content]       nội dung chuyển khoản, bỏ qua khi rỗng
 *   63 04 CRC                   CRC16-CCITT-FALSE trên toàn chuỗi kể cả "6304", hex in hoa
 */
const NAPAS_GUID = 'A000000727';
const SERVICE_TO_ACCOUNT = 'QRIBFTTA';
export const VIETQR_MAX_CONTENT = 25;

function tlv(id: string, value: string): string {
    if (value.length > 99) throw new Error(`VietQR TLV ${id} quá dài`);
    return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** Chỉ giữ chữ cái ASCII, số và khoảng trắng; tối đa 25 ký tự như ngân hàng yêu cầu. */
export function sanitizeTransferContent(content?: string | null): string {
    const s = String(content ?? '').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length > VIETQR_MAX_CONTENT ? s.slice(0, VIETQR_MAX_CONTENT).trim() : s;
}

/** CRC16-CCITT-FALSE: poly 0x1021, init 0xFFFF, không reflect, không xor cuối. */
export function crc16(input: string): string {
    let crc = 0xffff;
    for (const byte of Buffer.from(input, 'ascii')) {
        crc ^= byte << 8;
        for (let i = 0; i < 8; i += 1) {
            crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
            crc &= 0xffff;
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function buildVietQr(bin: string, accountNo: string, amount: number, content?: string): string {
    const cleanBin = String(bin || '').replace(/\D/g, '');
    const cleanAccount = String(accountNo || '').trim();
    if (!cleanBin || !cleanAccount) throw new Error('VietQR cần BIN ngân hàng và số tài khoản');

    const beneficiary = tlv('00', cleanBin) + tlv('01', cleanAccount);
    const merchantInfo = tlv('00', NAPAS_GUID) + tlv('01', beneficiary) + tlv('02', SERVICE_TO_ACCOUNT);
    let payload = tlv('00', '01') + tlv('01', '12') + tlv('38', merchantInfo) + tlv('53', '704');
    if (amount > 0) payload += tlv('54', String(Math.round(amount)));
    payload += tlv('58', 'VN');
    const purpose = sanitizeTransferContent(content);
    if (purpose) payload += tlv('62', tlv('08', purpose));
    payload += '6304';
    return payload + crc16(payload);
}
