import { PlatformCostConfig, IMonthlyCost, IPaymentFee } from '../infrastructure/models/system-config.model';
import { Order as OrderModel } from '../../order/infrastructure/models/order.model';
import { Coupon } from '../../promotion/infrastructure/models/coupon.model';
import { CommissionSetting } from '../../../shared/services/commission-setting.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 365;
const DAYS_PER_MONTH = 30;
const MAX_MONTHLY_COSTS = 30;
const MAX_GATEWAYS = 10;
const MAX_FEE_RATE = 0.2;
const MAX_MONTHLY_AMOUNT = 10_000_000_000;
const MAX_PER_ORDER_FEE = 100_000;
const MAX_CASH_RESERVE = 100_000_000_000;
const TREND_MONTHS = 6;
const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';
// Việt Nam không đổi giờ theo mùa nên đầu tháng giờ VN = 0h UTC trừ 7 tiếng.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface FinanceConfig {
    monthly_costs: IMonthlyCost[];
    payment_fees: (IPaymentFee & { is_default?: boolean })[];
    notification_per_order: number;
    cash_reserve: number;
    updated_at: Date | null;
}

export type FinanceConfigInput = Omit<FinanceConfig, 'updated_at'>;

type MixRow = { method: string; name: string; orders: number; amount: number; fee: number };

export interface FinanceOverview {
    period: { days: number; from: string; to: string };
    commission_percent: number;
    orders: { paid: number; refunded: number };
    gmv: number;
    shipping: number;
    paid_amount: number;
    /** Tổng giảm giá của đơn đã thanh toán (voucher sàn + voucher shop). */
    discount: number;
    pnl: {
        commission: number;
        platform_voucher: number;
        net_revenue: number;
        payment_fees: number;
        refund_losses: number;
        notification: number;
        contribution: number;
        fixed_costs: number;
        net_profit: number;
    };
    refunded_commission: number;
    payment_mix: MixRow[];
    take_rate: number | null;
    contribution_per_order: number | null;
    /** Kỳ liền trước, cùng độ dài, để so sánh tăng/giảm. */
    previous: { orders: number; gmv: number; net_revenue: number; contribution: number; net_profit: number };
    monthly: {
        fixed_costs: number;
        orders: number;
        net_profit: number;
        break_even_orders: number | null;
        break_even_gmv: number | null;
        margin_of_safety: number | null;
        /** Vốn dự phòng đủ bù lỗ bao nhiêu tháng; null khi đang lãi hoặc chưa nhập vốn. */
        runway_months: number | null;
    };
    trend: {
        month: string;
        orders: number;
        gmv: number;
        net_revenue: number;
        contribution: number;
        fixed_costs: number;
        net_profit: number;
        /** Tháng đang chạy: chi phí cố định chỉ tính số ngày đã qua. */
        partial: boolean;
    }[];
    baseline: {
        aov: number | null;
        shipping_per_order: number | null;
        commission_percent: number;
        payment_fee_rate: number;
        refund_rate: number;
        refund_fee_ratio: number;
        voucher_per_order: number;
        notification_per_order: number;
    };
}

// 4 khoản cố định mặc định: không xóa, không đổi tên, chỉ sửa số tiền. legacyKey đọc số từ cấu hình cũ.
const DEFAULT_COSTS = [
    { key: 'server', name: 'Máy chủ backend (VPS)', legacyKey: 'vps_base_monthly', amount: 1_200_000 },
    { key: 'frontend', name: 'Hosting frontend / CDN', legacyKey: 'frontend_hosting', amount: 500_000 },
    { key: 'domain', name: 'Tên miền & DNS', legacyKey: 'domain_monthly', amount: 40_000 },
    { key: 'ssl', name: 'SSL & bảo mật', legacyKey: 'security_ssl', amount: 260_000 },
];

// Cổng mặc định: không xóa được, chỉ sửa phí. Phí mặc định 0 vì hiện chưa tính phí cổng.
const DEFAULT_GATEWAYS = [
    { code: 'VNPAY', name: 'VNPAY' },
    { code: 'PAYOS', name: 'PayOS' },
    { code: 'COD', name: 'COD (thu hộ)' },
];

const DEFAULT_NOTIFICATION_FEE = 1000;

/** "Ví MoMo" → "VI_MOMO". Mã phải trùng `payment_method` mà đơn hàng lưu khi tích hợp cổng mới. */
export function gatewayCode(name: string): string {
    return name
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/đ/gi, 'D')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

// Doc lưu trước khi có `key` thì nhận khoản mặc định theo tên.
const isDefault = (d: typeof DEFAULT_COSTS[number], c: any) => c?.key === d.key || (!c?.key && c?.name === d.name);

function toConfig(raw: any): FinanceConfig {
    const saved: any[] = Array.isArray(raw?.monthly_costs) ? raw.monthly_costs : [];
    const monthly_costs: IMonthlyCost[] = [
        ...DEFAULT_COSTS.map(d => ({
            key: d.key,
            name: d.name,
            amount: saved.find(c => isDefault(d, c))?.amount ?? raw?.fixed_costs?.[d.legacyKey] ?? d.amount,
        })),
        ...saved
            .filter(c => !DEFAULT_COSTS.some(d => isDefault(d, c)))
            .map(c => ({ name: c.name, amount: c.amount })),
    ];

    // Bản lưu trước đây là object { VNPAY: {...} }; nay là danh sách để thêm được cổng mới.
    const savedFees: any[] = Array.isArray(raw?.payment_fees)
        ? raw.payment_fees
        : Object.entries(raw?.payment_fees ?? {}).map(([code, f]: [string, any]) => ({ code, ...f }));
    const fee = (f: any) => ({ rate: f?.rate ?? 0, fixed: f?.fixed ?? 0 });
    const payment_fees = [
        ...DEFAULT_GATEWAYS.map(g => ({ ...g, ...fee(savedFees.find(f => f.code === g.code)), is_default: true })),
        ...savedFees
            .filter(f => f.code && !DEFAULT_GATEWAYS.some(g => g.code === f.code))
            .map(f => ({ code: f.code, name: f.name ?? f.code, ...fee(f) })),
    ];

    return {
        monthly_costs,
        payment_fees,
        notification_per_order:
            raw?.notification_per_order ?? raw?.unit_costs?.notification_per_order ?? DEFAULT_NOTIFICATION_FEE,
        cash_reserve: raw?.cash_reserve ?? 0,
        updated_at: raw?.updated_at ?? null,
    };
}

function readNumber(value: unknown, label: string, max: number, maxLabel: string): number {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(n) || n < 0 || n > max) {
        throw new Error(`${label} phải là số từ 0 đến ${maxLabel}`);
    }
    return n;
}

/** Kiểm tra body PUT /config; ném lỗi tiếng Việt để router trả 400. */
export function parseConfigInput(body: any): FinanceConfigInput {
    if (!Array.isArray(body?.monthly_costs)) throw new Error('Thiếu danh sách chi phí cố định');
    if (body.monthly_costs.length > MAX_MONTHLY_COSTS) {
        throw new Error(`Tối đa ${MAX_MONTHLY_COSTS} khoản chi phí cố định`);
    }

    const items: any[] = body.monthly_costs;
    const defaults = DEFAULT_COSTS.map(d => {
        const c = items.find(x => x?.key === d.key);
        if (!c) throw new Error(`Không được xóa khoản mặc định "${d.name}"`);
        return {
            key: d.key,
            name: d.name,
            amount: Math.round(readNumber(c.amount, `Khoản "${d.name}"`, MAX_MONTHLY_AMOUNT, '10 tỷ đồng')),
        };
    });
    const extras = items
        .filter(x => !DEFAULT_COSTS.some(d => d.key === x?.key))
        .map((c, i) => {
            const name = typeof c?.name === 'string' ? c.name.trim() : '';
            if (!name || name.length > 60) throw new Error(`Khoản chi phí thêm thứ ${i + 1} cần tên dài 1–60 ký tự`);
            return {
                name,
                amount: Math.round(readNumber(c.amount, `Khoản "${name}"`, MAX_MONTHLY_AMOUNT, '10 tỷ đồng')),
            };
        });
    const monthly_costs = [...defaults, ...extras];

    if (!Array.isArray(body?.payment_fees)) throw new Error('Thiếu danh sách cổng thanh toán');
    if (body.payment_fees.length > MAX_GATEWAYS) throw new Error(`Tối đa ${MAX_GATEWAYS} cổng thanh toán`);
    const gateways: any[] = body.payment_fees;
    const readFee = (f: any, label: string) => ({
        rate: Math.round(readNumber(f?.rate, `Phí % của ${label}`, MAX_FEE_RATE, '20%') * 10_000) / 10_000,
        fixed: Math.round(readNumber(f?.fixed, `Phí cố định của ${label}`, MAX_PER_ORDER_FEE, '100.000đ')),
    });
    const defaultFees = DEFAULT_GATEWAYS.map(g => {
        const f = gateways.find(x => x?.code === g.code);
        if (!f) throw new Error(`Không được xóa cổng mặc định "${g.name}"`);
        return { ...g, ...readFee(f, g.name) };
    });
    const usedCodes = new Set(DEFAULT_GATEWAYS.map(g => g.code));
    // Mã cổng tự thêm luôn tính lại từ tên, không tin mã client gửi lên.
    const extraFees = gateways
        .filter(x => !DEFAULT_GATEWAYS.some(g => g.code === x?.code))
        .map((f, i) => {
            const name = typeof f?.name === 'string' ? f.name.trim() : '';
            const code = gatewayCode(name);
            if (!code || name.length > 40) throw new Error(`Cổng thêm thứ ${i + 1} cần tên dài 1–40 ký tự, có chữ hoặc số`);
            if (usedCodes.has(code)) throw new Error(`Cổng "${name}" trùng mã ${code} với cổng đã có`);
            usedCodes.add(code);
            return { code, name, ...readFee(f, name) };
        });
    const payment_fees = [...defaultFees, ...extraFees];

    const notification_per_order = Math.round(
        readNumber(body?.notification_per_order, 'Phí thông báo', MAX_PER_ORDER_FEE, '100.000đ'),
    );
    const cash_reserve = Math.round(readNumber(body?.cash_reserve ?? 0, 'Vốn dự phòng', MAX_CASH_RESERVE, '100 tỷ đồng'));

    return { monthly_costs, payment_fees, notification_per_order, cash_reserve };
}

export interface OverviewRange {
    from: Date;
    /** Mốc kết thúc (không tính), có thể là cuối hôm nay. */
    to: Date;
    days: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 0h giờ VN của ngày `s` (YYYY-MM-DD). Kiểm cả ngày không có thật như 30/02 (JS tự cuộn sang 02/03). */
function vnDayStart(s: unknown, label: string): number {
    const t = typeof s === 'string' && DATE_RE.test(s) ? Date.parse(`${s}T00:00:00+07:00`) : NaN;
    if (!Number.isFinite(t) || new Date(t + VN_OFFSET_MS).toISOString().slice(0, 10) !== s) {
        throw new Error(`${label} không hợp lệ (cần dạng YYYY-MM-DD)`);
    }
    return t;
}

/**
 * Kỳ báo cáo từ query: `?days=30` (cuộn tới hiện tại) hoặc `?from=YYYY-MM-DD&to=YYYY-MM-DD`
 * (tính trọn từng ngày theo giờ VN, ngày kết thúc quá hôm nay thì cắt về hôm nay).
 */
export function parseRange(query: any, now = new Date()): OverviewRange {
    if (query?.from !== undefined || query?.to !== undefined) {
        const from = vnDayStart(query.from, 'Ngày bắt đầu');
        const toDay = vnDayStart(query.to, 'Ngày kết thúc');
        if (toDay < from) throw new Error('Ngày kết thúc phải bằng hoặc sau ngày bắt đầu');
        const vnNow = new Date(now.getTime() + VN_OFFSET_MS);
        const endOfToday =
            Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + 1) - VN_OFFSET_MS;
        if (from >= endOfToday) throw new Error('Ngày bắt đầu không được ở tương lai');
        const to = Math.min(toDay + DAY_MS, endOfToday);
        const days = Math.round((to - from) / DAY_MS);
        if (days > MAX_RANGE_DAYS) throw new Error(`Khoảng thời gian tối đa ${MAX_RANGE_DAYS} ngày`);
        return { from: new Date(from), to: new Date(to), days };
    }
    const days = Math.min(MAX_RANGE_DAYS, Math.max(1, Math.floor(Number(query?.days)) || 30));
    return { from: new Date(now.getTime() - days * DAY_MS), to: now, days };
}

/** Cộng các nhóm đơn (gom theo trạng thái, cổng, mã giảm giá) thành các dòng lãi lỗ. */
function summarize(groups: any[], config: FinanceConfig, platformCodes: Set<string>) {
    const feeByCode = new Map(config.payment_fees.map(f => [f.code, f]));
    const mix = new Map<string, MixRow>();
    let paid = 0, refunded = 0, gmv = 0, shipping = 0, paidAmount = 0, discount = 0, commission = 0;
    let platformVoucher = 0, paymentFees = 0, refundLosses = 0, refundedCommission = 0;

    for (const g of groups) {
        const method = String(g._id.method);
        // Cổng chưa cấu hình phí (vd đơn VNPAY cũ) tính phí 0.
        const rule = feeByCode.get(method) ?? { rate: 0, fixed: 0 };
        const amount = (g.gmv || 0) + (g.shipping || 0) - (g.discount || 0);
        const fee = amount * rule.rate + g.orders * rule.fixed;

        if (g._id.status === 'PAID') {
            paid += g.orders;
            gmv += g.gmv || 0;
            shipping += g.shipping || 0;
            paidAmount += amount;
            discount += g.discount || 0;
            commission += g.commission || 0;
            paymentFees += fee;
            if (platformCodes.has(g._id.coupon)) platformVoucher += g.discount || 0;
            const m = mix.get(method) ?? { method, name: feeByCode.get(method)?.name ?? method, orders: 0, amount: 0, fee: 0 };
            m.orders += g.orders;
            m.amount += amount;
            m.fee += fee;
            mix.set(method, m);
        } else {
            refunded += g.orders;
            refundLosses += fee;
            refundedCommission += g.commission || 0;
        }
    }

    const notification = (paid + refunded) * config.notification_per_order;
    const netRevenue = commission - platformVoucher;
    return {
        paid, refunded, gmv, shipping, paidAmount, discount, commission, platformVoucher, paymentFees,
        refundLosses, refundedCommission, notification, netRevenue,
        contribution: netRevenue - paymentFees - refundLosses - notification,
        mix: [...mix.values()].sort((a, b) => b.orders - a.orders),
    };
}

export class PlatformFinanceService {
    async getConfig(): Promise<FinanceConfig> {
        const raw = await PlatformCostConfig.findOne().sort({ updated_at: -1 }).lean();
        return toConfig(raw);
    }

    async updateConfig(input: FinanceConfigInput): Promise<FinanceConfig> {
        const saved = await PlatformCostConfig.findOneAndUpdate(
            {},
            { $set: input },
            { upsert: true, new: true, sort: { updated_at: -1 } },
        ).lean();
        return toConfig(saved);
    }

    /**
     * Báo cáo lãi lỗ của sàn trong một kỳ. Lọc đơn giống trang Thống kê thu nhập:
     * đơn PAID là doanh thu, đơn REFUNDED chỉ tính phần phí cổng đã mất.
     */
    async getOverview(range: OverviewRange): Promise<FinanceOverview> {
        const { from, to, days: period } = range;
        const prevFrom = new Date(from.getTime() - period * DAY_MS);
        // Xu hướng luôn tính tới hôm nay, không phụ thuộc kỳ đang chọn.
        const now = new Date();
        const vnNow = new Date(now.getTime() + VN_OFFSET_MS);
        const monthStart = (back: number) =>
            new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth() - back, 1) - VN_OFFSET_MS);
        const trendFrom = monthStart(TREND_MONTHS - 1);

        const money = (field: string) => ({ $sum: { $toDouble: `$financial_breakdown.${field}` } });
        const sums = {
            orders: { $sum: 1 },
            gmv: money('subtotal'),
            shipping: money('shipping_fee'),
            discount: money('coupon_discount'),
            commission: money('platform_fee'),
        };
        const counted = { payment_status: { $in: ['PAID', 'REFUNDED'] } };
        const groupKey = { status: '$payment_status', method: '$payment_method', coupon: '$coupon_code' };

        const [config, windowGroups, monthGroups, commissionPercent] = await Promise.all([
            this.getConfig(),
            OrderModel.aggregate([
                { $match: { ...counted, created_at: { $gte: prevFrom, $lt: to } } },
                { $group: { _id: { ...groupKey, current: { $gte: ['$created_at', from] } }, ...sums } },
            ]),
            OrderModel.aggregate([
                { $match: { ...counted, created_at: { $gte: trendFrom, $lt: now } } },
                {
                    $group: {
                        _id: {
                            ...groupKey,
                            month: { $dateToString: { format: '%Y-%m', date: '$created_at', timezone: VN_TIMEZONE } },
                        },
                        ...sums,
                    },
                },
            ]),
            CommissionSetting.getPercent(),
        ]);

        const codes = [...new Set([...windowGroups, ...monthGroups].map((g: any) => g._id.coupon).filter(Boolean))];
        const platformCodes = new Set(
            codes.length
                ? (await Coupon.find({ code: { $in: codes }, shop_id: null }).select('code').lean()).map(c => c.code)
                : [],
        );

        const cur = summarize(windowGroups.filter((g: any) => g._id.current), config, platformCodes);
        const prev = summarize(windowGroups.filter((g: any) => !g._id.current), config, platformCodes);
        const { paid, refunded, gmv, shipping, commission, paymentFees, refundLosses, contribution } = cur;
        const monthlyFixed = config.monthly_costs.reduce((s, c) => s + c.amount, 0);
        const fixedCosts = (monthlyFixed * period) / DAYS_PER_MONTH;
        const contributionPerOrder = paid ? contribution / paid : null;
        const ordersPerMonth = (paid * DAYS_PER_MONTH) / period;
        const monthlyNet = (contribution * DAYS_PER_MONTH) / period - monthlyFixed;
        const breakEven = contributionPerOrder !== null && contributionPerOrder > 0
            ? Math.ceil(monthlyFixed / contributionPerOrder)
            : null;
        const round = Math.round;

        const trend = Array.from({ length: TREND_MONTHS }, (_, i) => {
            const back = TREND_MONTHS - 1 - i;
            const start = monthStart(back);
            const key = new Date(start.getTime() + VN_OFFSET_MS).toISOString().slice(0, 7);
            const m = summarize(monthGroups.filter((g: any) => g._id.month === key), config, platformCodes);
            const share = back === 0
                ? (now.getTime() - start.getTime()) / (monthStart(-1).getTime() - start.getTime())
                : 1;
            const fixed = monthlyFixed * share;
            return {
                month: key,
                orders: m.paid,
                gmv: round(m.gmv),
                net_revenue: round(m.netRevenue),
                contribution: round(m.contribution),
                fixed_costs: round(fixed),
                net_profit: round(m.contribution - fixed),
                partial: back === 0,
            };
        });

        return {
            period: { days: period, from: from.toISOString(), to: to.toISOString() },
            commission_percent: commissionPercent,
            orders: { paid, refunded },
            gmv: round(gmv),
            shipping: round(shipping),
            paid_amount: round(cur.paidAmount),
            discount: round(cur.discount),
            pnl: {
                commission: round(commission),
                platform_voucher: round(cur.platformVoucher),
                net_revenue: round(cur.netRevenue),
                payment_fees: round(paymentFees),
                refund_losses: round(refundLosses),
                notification: round(cur.notification),
                contribution: round(contribution),
                fixed_costs: round(fixedCosts),
                net_profit: round(contribution - fixedCosts),
            },
            refunded_commission: round(cur.refundedCommission),
            payment_mix: cur.mix.map(m => ({ ...m, amount: round(m.amount), fee: round(m.fee) })),
            take_rate: gmv > 0 ? cur.netRevenue / gmv : null,
            contribution_per_order: contributionPerOrder === null ? null : round(contributionPerOrder),
            previous: {
                orders: prev.paid,
                gmv: round(prev.gmv),
                net_revenue: round(prev.netRevenue),
                contribution: round(prev.contribution),
                net_profit: round(prev.contribution - fixedCosts),
            },
            monthly: {
                fixed_costs: monthlyFixed,
                orders: round(ordersPerMonth),
                net_profit: round(monthlyNet),
                break_even_orders: breakEven,
                // Doanh số tiền hàng cần mỗi tháng, theo tỷ lệ lãi góp trên tiền hàng hiện tại.
                break_even_gmv: contribution > 0 && gmv > 0 ? round(monthlyFixed / (contribution / gmv)) : null,
                margin_of_safety: breakEven !== null && ordersPerMonth > 0
                    ? (ordersPerMonth - breakEven) / ordersPerMonth
                    : null,
                runway_months: config.cash_reserve > 0 && monthlyNet < 0 ? config.cash_reserve / -monthlyNet : null,
            },
            trend,
            baseline: {
                aov: paid ? round(gmv / paid) : null,
                shipping_per_order: paid ? round(shipping / paid) : null,
                // % cấu hình tính trên tiền người bán nhận: phí ÷ (tiền hàng − phí).
                commission_percent: gmv > commission ? (commission / (gmv - commission)) * 100 : commissionPercent,
                // Quy về % trên (tiền hàng + ship) để mô phỏng tái tạo đúng phí cổng thực tế.
                payment_fee_rate: gmv + shipping > 0 ? paymentFees / (gmv + shipping) : config.payment_fees.find(f => f.code === 'PAYOS')?.rate ?? 0,
                refund_rate: paid + refunded ? refunded / (paid + refunded) : 0,
                // Đơn hoàn thường là đơn trả trước nên mất phí cổng nhiều hơn đơn trung bình (có cả COD).
                refund_fee_ratio: refunded && paymentFees > 0 ? (refundLosses / refunded) / (paymentFees / paid) : 1,
                voucher_per_order: paid ? cur.platformVoucher / paid : 0,
                notification_per_order: config.notification_per_order,
            },
        };
    }
}

export const platformFinanceService = new PlatformFinanceService();
