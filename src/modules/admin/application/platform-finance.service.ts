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

export interface FinanceConfig {
    monthly_costs: IMonthlyCost[];
    payment_fees: (IPaymentFee & { is_default?: boolean })[];
    notification_per_order: number;
    updated_at: Date | null;
}

export type FinanceConfigInput = Omit<FinanceConfig, 'updated_at'>;

export interface FinanceOverview {
    period: { days: number; from: string; to: string };
    commission_percent: number;
    orders: { paid: number; refunded: number };
    gmv: number;
    shipping: number;
    paid_amount: number;
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
    payment_mix: { method: string; name: string; orders: number; amount: number; fee: number }[];
    take_rate: number | null;
    contribution_per_order: number | null;
    monthly: {
        fixed_costs: number;
        orders: number;
        break_even_orders: number | null;
        margin_of_safety: number | null;
    };
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
        .replace(/[̀-ͯ]/g, '')
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

    return { monthly_costs, payment_fees, notification_per_order };
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
     * Báo cáo lãi lỗ của sàn trong `days` ngày. Lọc đơn giống trang Thống kê thu nhập:
     * đơn PAID là doanh thu, đơn REFUNDED chỉ tính phần phí cổng đã mất.
     */
    async getOverview(days: number): Promise<FinanceOverview> {
        const period = Math.min(MAX_RANGE_DAYS, Math.max(1, Math.floor(days) || 30));
        const to = new Date();
        const from = new Date(to.getTime() - period * DAY_MS);
        const money = (field: string) => ({ $sum: { $toDouble: `$financial_breakdown.${field}` } });

        const [config, groups, commissionPercent] = await Promise.all([
            this.getConfig(),
            OrderModel.aggregate([
                { $match: { payment_status: { $in: ['PAID', 'REFUNDED'] }, created_at: { $gte: from, $lt: to } } },
                {
                    $group: {
                        _id: { status: '$payment_status', method: '$payment_method', coupon: '$coupon_code' },
                        orders: { $sum: 1 },
                        gmv: money('subtotal'),
                        shipping: money('shipping_fee'),
                        discount: money('coupon_discount'),
                        commission: money('platform_fee'),
                    },
                },
            ]),
            CommissionSetting.getPercent(),
        ]);

        const codes = [...new Set(groups.map((g: any) => g._id.coupon).filter(Boolean))];
        const platformCodes = new Set(
            codes.length
                ? (await Coupon.find({ code: { $in: codes }, shop_id: null }).select('code').lean()).map(c => c.code)
                : [],
        );

        const mix = new Map<string, FinanceOverview['payment_mix'][number]>();
        const feeByCode = new Map(config.payment_fees.map(f => [f.code, f]));
        let paid = 0, refunded = 0, gmv = 0, shipping = 0, paidAmount = 0, commission = 0;
        let platformVoucher = 0, paymentFees = 0, refundLosses = 0, refundedCommission = 0;

        for (const g of groups as any[]) {
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
        const contribution = netRevenue - paymentFees - refundLosses - notification;
        const monthlyFixed = config.monthly_costs.reduce((s, c) => s + c.amount, 0);
        const fixedCosts = (monthlyFixed * period) / DAYS_PER_MONTH;
        const contributionPerOrder = paid ? contribution / paid : null;
        const ordersPerMonth = (paid * DAYS_PER_MONTH) / period;
        const breakEven = contributionPerOrder !== null && contributionPerOrder > 0
            ? Math.ceil(monthlyFixed / contributionPerOrder)
            : null;
        const round = Math.round;

        return {
            period: { days: period, from: from.toISOString(), to: to.toISOString() },
            commission_percent: commissionPercent,
            orders: { paid, refunded },
            gmv: round(gmv),
            shipping: round(shipping),
            paid_amount: round(paidAmount),
            pnl: {
                commission: round(commission),
                platform_voucher: round(platformVoucher),
                net_revenue: round(netRevenue),
                payment_fees: round(paymentFees),
                refund_losses: round(refundLosses),
                notification: round(notification),
                contribution: round(contribution),
                fixed_costs: round(fixedCosts),
                net_profit: round(contribution - fixedCosts),
            },
            refunded_commission: round(refundedCommission),
            payment_mix: [...mix.values()].map(m => ({
                ...m,
                amount: round(m.amount),
                fee: round(m.fee),
            })),
            take_rate: gmv > 0 ? netRevenue / gmv : null,
            contribution_per_order: contributionPerOrder === null ? null : round(contributionPerOrder),
            monthly: {
                fixed_costs: monthlyFixed,
                orders: round(ordersPerMonth),
                break_even_orders: breakEven,
                margin_of_safety: breakEven !== null && ordersPerMonth > 0
                    ? (ordersPerMonth - breakEven) / ordersPerMonth
                    : null,
            },
            baseline: {
                aov: paid ? round(gmv / paid) : null,
                shipping_per_order: paid ? round(shipping / paid) : null,
                // % cấu hình tính trên tiền người bán nhận: phí ÷ (tiền hàng − phí).
                commission_percent: gmv > commission ? (commission / (gmv - commission)) * 100 : commissionPercent,
                // Quy về % trên (tiền hàng + ship) để mô phỏng tái tạo đúng phí cổng thực tế.
                payment_fee_rate: gmv + shipping > 0 ? paymentFees / (gmv + shipping) : feeByCode.get('PAYOS')?.rate ?? 0,
                refund_rate: paid + refunded ? refunded / (paid + refunded) : 0,
                // Đơn hoàn thường là đơn trả trước nên mất phí cổng nhiều hơn đơn trung bình (có cả COD).
                refund_fee_ratio: refunded && paymentFees > 0 ? (refundLosses / refunded) / (paymentFees / paid) : 1,
                voucher_per_order: paid ? platformVoucher / paid : 0,
                notification_per_order: config.notification_per_order,
            },
        };
    }
}

export const platformFinanceService = new PlatformFinanceService();
