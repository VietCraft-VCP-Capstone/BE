/**
 * Quy đổi mã ngân hàng payOS trả về (counterAccountBankId) sang BIN Napas 6 số mà payOS
 * payout yêu cầu (toBin).
 *
 * payOS có lúc trả thẳng BIN 6 số, có lúc trả mã CITAD 8 số (ví dụ "01201001"): 2 số tỉnh,
 * 3 số mã ngân hàng của NHNN, 3 số chi nhánh. Chỉ 3 số giữa xác định ngân hàng.
 *
 * Bảng dưới đối chiếu hai nguồn, không suy đoán:
 * - Mã 3 số: danh sách mã CITAD của HSBC Việt Nam (personal-internet-local-clearing-code.pdf).
 * - BIN: danh sách ngân hàng của VietQR (api.vietqr.io/v2/banks).
 * Chỉ giữ các mã mà tên ngân hàng ở hai nguồn khớp nhau. Mã không có ở đây thì không hoàn
 * tự động (trả undefined) thay vì đoán: chuyển nhầm ngân hàng là mất tiền thật.
 */
const SBV_TO_BIN: Record<string, string> = {
    '201': '970415', // VietinBank
    '202': '970418', // BIDV
    '203': '970436', // Vietcombank
    '204': '970405', // Agribank
    '302': '970426', // MSB
    '303': '970403', // Sacombank
    '305': '970431', // Eximbank
    '306': '970428', // Nam A Bank
    '307': '970416', // ACB
    '308': '970400', // Saigonbank
    '309': '970432', // VPBank
    '310': '970407', // Techcombank
    '311': '970422', // MB Bank
    '313': '970409', // Bac A Bank
    '314': '970441', // VIB
    '317': '970440', // SeABank
    '319': '970414', // Ocean Bank, nay là MBV
    '320': '970408', // GPBank
    '321': '970437', // HDBank
    '323': '970425', // ABBANK
    '327': '970454', // Viet Capital Bank (BVBank)
    '333': '970448', // OCB
    '334': '970429', // SCB
    '339': '970444', // CBBank
    '341': '970430', // PG Bank
    '348': '970443', // SHB
    '352': '970419', // NCB
    '353': '970452', // Kienlong Bank
    '355': '970427', // VietABank
    '356': '970433', // VietBank
    '357': '970449', // LienVietPost, nay là LPBank
    '358': '970423', // TPBank
    '359': '970438', // BaoViet Bank
    '360': '970412', // PVcomBank
    '501': '970439', // Public Bank Việt Nam
    '502': '970434', // Indovina Bank
    '505': '970421', // VRB
    '603': '970442', // Hong Leong Bank
    '604': '970410', // Standard Chartered
    '616': '970424', // Shinhan Bank
    '663': '970457', // Woori Bank
    '665': '970458', // UOB
    '901': '970446', // Co-opBank
};

/** BIN 6 số giữ nguyên; mã CITAD 8 số quy theo bảng; còn lại (không nhận ra) trả undefined. */
export function toNapasBin(raw: unknown): string | undefined {
    const code = String(raw ?? '').trim();
    if (/^\d{6}$/.test(code)) return code;
    if (/^\d{8}$/.test(code)) return SBV_TO_BIN[code.slice(2, 5)];
    return undefined;
}

/** Tên ngắn theo VietQR cho các BIN ở bảng trên, để người bán chuyển khoản tay biết đúng ngân hàng. */
const BIN_NAME: Record<string, string> = {
    '970415': 'VietinBank', '970418': 'BIDV', '970436': 'Vietcombank', '970405': 'Agribank',
    '970426': 'MSB', '970403': 'Sacombank', '970431': 'Eximbank', '970428': 'Nam A Bank',
    '970416': 'ACB', '970400': 'Saigonbank', '970432': 'VPBank', '970407': 'Techcombank',
    '970422': 'MB Bank', '970409': 'Bac A Bank', '970441': 'VIB', '970440': 'SeABank',
    '970414': 'MBV', '970408': 'GPBank', '970437': 'HDBank', '970425': 'ABBANK',
    '970454': 'BVBank', '970448': 'OCB', '970429': 'SCB', '970444': 'CBBank',
    '970430': 'PGBank', '970443': 'SHB', '970419': 'NCB', '970452': 'KienlongBank',
    '970427': 'VietABank', '970433': 'VietBank', '970449': 'LPBank', '970423': 'TPBank',
    '970438': 'BaoViet Bank', '970412': 'PVcomBank', '970439': 'Public Bank', '970434': 'Indovina Bank',
    '970421': 'VRB', '970442': 'Hong Leong Bank', '970410': 'Standard Chartered', '970424': 'Shinhan Bank',
    '970457': 'Woori Bank', '970458': 'UOB', '970446': 'Co-opBank',
};

export function bankNameOf(bin?: string | null): string | undefined {
    return bin ? BIN_NAME[bin] : undefined;
}
