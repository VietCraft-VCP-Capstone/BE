/** Napas BIN -> tên hiển thị của các ngân hàng phổ biến. BIN lạ hiển thị chính nó. */
const NAMES: Record<string, string> = {
    '970422': 'MB Bank', '970436': 'Vietcombank', '970415': 'VietinBank', '970418': 'BIDV',
    '970405': 'Agribank', '970407': 'Techcombank', '970416': 'ACB', '970432': 'VPBank',
    '970423': 'TPBank', '970403': 'Sacombank', '970441': 'VIB', '970443': 'SHB',
    '970437': 'HDBank', '970426': 'MSB', '970448': 'OCB', '970431': 'Eximbank',
    '970429': 'SCB', '970454': 'BVBank', '970406': 'DongA Bank', '970449': 'LPBank',
    '970414': 'MBV (Oceanbank)', '970430': 'PGBank', '970438': 'BaoViet Bank', '970433': 'VietBank',
    '970440': 'SeABank', '970428': 'Nam A Bank', '970409': 'Bac A Bank', '970412': 'PVcomBank',
    '970408': 'GPBank', '970452': 'KienlongBank', '970400': 'Saigonbank', '970424': 'Shinhan Bank',
    '970425': 'ABBANK', '970427': 'VietABank', '970419': 'NCB', '970410': 'Standard Chartered',
    '970442': 'Hong Leong Bank', '970439': 'Public Bank', '970457': 'Woori Bank', '970458': 'UOB',
    '970455': 'IBK', '970421': 'VRB', '970446': 'Co-opBank', '970434': 'Indovina Bank',
    '546034': 'CAKE', '546035': 'Ubank', '963388': 'Timo', '971005': 'Viettel Money',
    '971011': 'VNPT Money', '970444': 'CBBank', '970462': 'Kookmin Bank HN', '970463': 'Kookmin Bank HCM',
};

/**
 * Mã viết tắt mà màn hình cài đặt thanh toán của seller lưu vào `shop.bank_info.bank_code`
 * (FE `SUPPORTED_BANKS`). Cần map sang BIN để so tài khoản nhận hoàn với tài khoản shop.
 */
const SHORT_CODES: Record<string, string> = {
    VCB: '970436', MB: '970422', MBB: '970422', TCB: '970407', BIDV: '970418',
    CTG: '970415', ICB: '970415', ACB: '970416', TPB: '970423', VPB: '970432',
    AGR: '970405', VBA: '970405', STB: '970403', HDB: '970437', VIB: '970441',
    SHB: '970443', MSB: '970426', OCB: '970448', EIB: '970431', SCB: '970429',
    SEAB: '970440', LPB: '970449', NAB: '970428', PVCB: '970412', ABB: '970425',
};

/**
 * BIN Napas gồm 6 chữ số. payOS payout và VietQR đều từ chối mã liên ngân hàng 8 số (CITAD).
 */
export function isBin(value: unknown): boolean {
    return /^\d{6}$/.test(String(value ?? '').trim());
}

export function bankNameOf(bin?: string | null): string | undefined {
    const clean = String(bin ?? '').trim();
    if (!clean) return undefined;
    return NAMES[clean] || clean;
}

/** Nhận BIN hoặc mã viết tắt (VCB, MB...), trả về BIN; không nhận ra thì trả về undefined. */
export function binOf(bankCode?: string | null): string | undefined {
    const clean = String(bankCode ?? '').trim();
    if (isBin(clean)) return clean;
    return SHORT_CODES[clean.toUpperCase()];
}
