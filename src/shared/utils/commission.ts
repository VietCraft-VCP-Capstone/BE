/**
 * Hoa hồng sàn — phần sàn cộng thêm vào giá người bán muốn nhận.
 *
 * Người bán nhập giá họ muốn nhận (net). Giá niêm yết người mua trả là net cộng
 * hoa hồng. Khi lên đơn, phí sàn được bóc lại từ giá niêm yết, nên người bán nhận
 * đúng con số đã nhập:
 *
 *     gross  = round(net × (1 + p/100))
 *     fee    = round(gross × p / (100 + p))
 *     payout = gross − fee = net
 *
 * Hai công thức là nghịch đảo của nhau và phải đi cùng nhau: đổi một bên mà quên
 * bên kia là người bán bị trừ hai lần. `demo()` ở cuối file canh đúng chỗ đó.
 */

/** Trần % hoa hồng. Cao hơn mức này gần như chắc chắn là nhập sai (nhập 500 thay vì 5). */
export const MAX_COMMISSION_PERCENT = 50;

/** % mặc định khi sàn chưa cấu hình — giữ đúng mức PLATFORM_FEE_RATE 0,05 trước đây. */
export const DEFAULT_COMMISSION_PERCENT = 5;

/**
 * Kiểm và chuẩn hoá % nhận từ ngoài (body request). Ném lỗi thay vì âm thầm về 0:
 * đây là đường tiền, nhập sai phải báo chứ không được lặng lẽ bỏ hoa hồng.
 */
export function parseCommissionPercent(input: unknown): number {
    // Number('') và Number(null) đều ra 0, nên phải loại trước khi đổi sang số —
    // thiếu trường trong body là lỗi nhập, không phải "hoa hồng 0%".
    if (typeof input !== 'number' && typeof input !== 'string') {
        throw new Error('Phần trăm hoa hồng phải là một số');
    }
    const text = typeof input === 'string' ? input.trim() : String(input);
    const percent = text ? Number(text) : NaN;
    if (!Number.isFinite(percent)) {
        throw new Error('Phần trăm hoa hồng phải là một số');
    }
    if (percent < 0 || percent > MAX_COMMISSION_PERCENT) {
        throw new Error(`Phần trăm hoa hồng phải trong khoảng 0–${MAX_COMMISSION_PERCENT}`);
    }
    return Math.round(percent * 100) / 100;
}

/** Giá niêm yết = giá người bán nhận + hoa hồng sàn. */
export function withCommission(net: number, percent: number): number {
    return Math.round(net * (1 + percent / 100));
}

/** Hoa hồng bóc lại từ giá niêm yết — nghịch đảo của withCommission(). */
export function commissionFromGross(gross: number, percent: number): number {
    return Math.round((gross * percent) / (100 + percent));
}

/**
 * Một luật hoa hồng. Trường để `null` nghĩa là "mọi giá trị" — luật không ràng buộc
 * chiều đó. Luật cả hai trường null chính là mức mặc định của sàn.
 */
export interface CommissionRule {
    categoryId: string | null;
    productType: string | null;
    percent: number;
}

/**
 * Độ cụ thể của luật. Càng nhiều chiều được ràng buộc thì càng cụ thể, và luật cụ thể
 * hơn phải thắng — "Áo thun + POD" đè "mọi hàng POD", chứ không phải ngược lại.
 */
function specificity(rule: CommissionRule): number {
    return (rule.categoryId ? 2 : 0) + (rule.productType ? 1 : 0);
}

/**
 * Chọn luật áp cho một sản phẩm. Trả về `null` khi không luật nào khớp — nơi gọi phải
 * rơi về mức mặc định của sàn.
 *
 * `categoryId` là danh mục CHÍNH của sản phẩm (`category_ids[0]`). Sản phẩm nhiều danh mục
 * vẫn chỉ tra theo danh mục đầu: so sánh chéo giữa các danh mục sẽ cho kết quả phụ thuộc
 * thứ tự mảng, người bán không tự kiểm được mình đang chịu mức nào.
 *
 * ponytail: bảng luật chỉ vài chục dòng nên quét tuyến tính; cần nhanh hơn thì đánh index
 * theo cặp (categoryId, productType) lúc nạp cache.
 */
export function pickCommissionRule<T extends CommissionRule>(
    rules: T[],
    categoryId: string | null | undefined,
    productType: string | null | undefined,
): T | null {
    let best: T | null = null;
    let bestScore = -1;
    for (const rule of rules) {
        if (rule.categoryId && rule.categoryId !== categoryId) continue;
        if (rule.productType && rule.productType !== productType) continue;
        const score = specificity(rule);
        // `>` chứ không `>=`: hai luật cùng độ cụ thể là dữ liệu hỏng (trùng phạm vi),
        // giữ luật gặp trước để kết quả không đổi theo thứ tự đọc từ DB.
        if (score > bestScore) {
            best = rule;
            bestScore = score;
        }
    }
    return best;
}

/** Khoá nhận dạng phạm vi của luật — dùng để chặn hai luật trùng phạm vi. */
export function ruleScopeKey(rule: CommissionRule): string {
    return `${rule.categoryId || '*'}|${rule.productType || '*'}`;
}

/**
 * Tự kiểm: `npx ts-node src/shared/utils/commission.ts`
 *
 * Điều kiện duy nhất phải giữ là người bán nhận lại đúng số đã nhập, ở mọi mức giá
 * và mọi mức hoa hồng. Quét 44k cặp (net, %) cho sai số bằng 0 tuyệt đối.
 */
function demo(): void {
    const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(`FAIL: ${msg}`); };

    assert(withCommission(115000, 5) === 120750, 'ví dụ trong tài liệu: 115.000 + 5% = 120.750');
    assert(commissionFromGross(120750, 5) === 5750, 'phí sàn bóc lại từ 120.750 phải là 5.750');
    assert(withCommission(115000, 0) === 115000, 'hoa hồng 0% không được đổi giá');

    let checked = 0;
    for (const percent of [0, 1, 2.5, 5, 7, 8.88, 10, 15, 20, 33.33, 50]) {
        for (let net = 1; net <= 2_000_000; net += net < 2000 ? 1 : 997) {
            const gross = withCommission(net, percent);
            const payout = gross - commissionFromGross(gross, percent);
            assert(payout === net, `net=${net} percent=${percent} -> payout=${payout}`);
            assert(gross >= net, `giá niêm yết không được thấp hơn giá người bán nhận (net=${net})`);
            checked++;
        }
    }

    // Bảng luật mẫu đúng như ví dụ đã chốt với sản phẩm.
    const rules: CommissionRule[] = [
        { categoryId: 'trang-suc', productType: null, percent: 8 },
        { categoryId: 'ao-thun', productType: 'POD_TEMPLATE', percent: 3 },
        { categoryId: null, productType: 'POD_TEMPLATE', percent: 4 },
        { categoryId: null, productType: null, percent: 5 },
    ];
    const pick = (c: string | null, t: string | null) => pickCommissionRule(rules, c, t)?.percent;

    assert(pick('ao-thun', 'POD_TEMPLATE') === 3, 'luật cụ thể nhất (danh mục + loại) phải thắng');
    assert(pick('ao-thun', 'READY_TO_SHIP') === 5, 'áo thun hàng có sẵn không có luật riêng -> mặc định');
    assert(pick('trang-suc', 'POD_TEMPLATE') === 8, 'luật theo danh mục đè luật theo loại');
    assert(pick('ly-tach', 'POD_TEMPLATE') === 4, 'không có luật danh mục -> rơi về luật theo loại');
    assert(pick('ly-tach', 'READY_TO_SHIP') === 5, 'không khớp luật nào -> mặc định');
    assert(pick(null, null) === 5, 'sản phẩm chưa gắn danh mục -> mặc định, không được trống');
    assert(pick(null, 'POD_TEMPLATE') === 4, 'chưa gắn danh mục nhưng là POD -> luật theo loại');
    assert(pickCommissionRule([], 'bat-ky', 'POD_TEMPLATE') === null, 'bảng rỗng phải trả null để nơi gọi dùng mặc định');

    // Thứ tự trong mảng không được làm đổi kết quả.
    const shuffled = [...rules].reverse();
    for (const [c, t] of [['ao-thun', 'POD_TEMPLATE'], ['trang-suc', 'POD_TEMPLATE'], ['ly-tach', 'POD_TEMPLATE']] as const) {
        assert(
            pickCommissionRule(shuffled, c, t)?.percent === pick(c, t),
            `đảo thứ tự bảng luật không được đổi kết quả (${c}, ${t})`,
        );
    }

    assert(ruleScopeKey({ categoryId: null, productType: null, percent: 5 }) === '*|*', 'khoá phạm vi mặc định');
    assert(
        ruleScopeKey({ categoryId: 'a', productType: 'B', percent: 1 }) !==
            ruleScopeKey({ categoryId: 'a', productType: null, percent: 1 }),
        'hai phạm vi khác nhau phải cho khoá khác nhau',
    );

    for (const bad of ['', null, undefined, NaN, 'abc', -1, 50.01, 500]) {
        let threw = false;
        try { parseCommissionPercent(bad); } catch { threw = true; }
        assert(threw, `parseCommissionPercent(${JSON.stringify(bad)}) phải ném lỗi`);
    }
    assert(parseCommissionPercent('7.5') === 7.5, 'chuỗi số hợp lệ phải nhận');

    console.log(`OK — ${checked} cặp (giá, %) đều cho payout khớp tuyệt đối`);
}

if (require.main === module) demo();
