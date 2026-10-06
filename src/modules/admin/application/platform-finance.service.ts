import mongoose from 'mongoose';
import { PlatformCostConfig, IPlatformCostConfig } from '../infrastructure/models/system-config.model';
import { Order as OrderModel } from '../../order/infrastructure/models/order.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { Design } from '../../design/infrastructure/models/design.model';
import { logger } from '../../../shared/utils/logger';

export interface CvpAnalysisResult {
    period_days: number;
    active_sellers: number;
    completed_orders: number;
    total_gmv: number;
    aov: number; // Average Order Value
    actual_platform_revenue: number;
    total_fixed_costs: number;
    total_variable_costs: number;
    total_costs: number;
    net_profit: number;
    is_profitable: boolean;
    break_even_orders: number;
    break_even_gmv: number;
    margin_of_safety_pct: number;
    unit_economics: {
        revenue_per_order: number;
        variable_cost_per_order: number;
        contribution_margin_per_order: number;
        contribution_margin_ratio: number;
    };
    breakdown: {
        fixed_costs: {
            domain: number;
            vps: number;
            frontend: number;
            ssl: number;
            subtotal: number;
        };
        infrastructure_costs: {
            active_seller_db: number;
            storage_estimated: number;
            ai_estimated: number;
            subtotal: number;
        };
        variable_costs: {
            payment_gateway: number;
            notification: number;
            subtotal_per_order: number;
        };
    };
}

export interface SimulationPoint {
    quantity: number;
    totalRevenue: number;
    totalCost: number;
    fixedCost: number;
    netProfit: number;
}

export interface SimulationResult {
    simulated_orders: number;
    simulated_commission_rate: number;
    simulated_aov: number;
    projected_revenue: number;
    projected_total_cost: number;
    projected_net_profit: number;
    is_profitable: boolean;
    break_even_orders: number;
    break_even_gmv: number;
    margin_of_safety_pct: number;
    unit_contribution_margin: number;
    chart_series: SimulationPoint[];
}

export class PlatformFinanceService {
    /**
     * Lấy cấu hình chi phí sàn (tự động khởi tạo cấu hình mặc định nếu chưa có)
     */
    async getConfig(): Promise<IPlatformCostConfig> {
        let config = await PlatformCostConfig.findOne().sort({ updated_at: -1 });
        if (!config) {
            config = await PlatformCostConfig.create({
                fixed_costs: {
                    domain_monthly: 40000,
                    vps_base_monthly: 1200000,
                    frontend_hosting: 500000,
                    security_ssl: 260000,
                },
                unit_costs: {
                    storage_per_gb: 600,
                    ai_per_request: 150,
                    db_per_active_seller: 5000,
                    payment_gateway_rate: 0.015,
                    notification_per_order: 1000,
                },
                seller_quotas: {
                    free_storage_gb: 1.0,
                    free_ai_requests: 20,
                    overage_markup_rate: 0.15,
                },
                policies: {
                    default_commission_rate: 0.10,
                    min_order_fee: 10000,
                    max_voucher_profit_share: 0.30,
                },
            });
            logger.info('[PlatformFinance] Khởi tạo cấu hình chi phí sàn mặc định ban đầu');
        }
        return config;
    }

    /**
     * Cập nhật cấu hình chi phí và chính sách sàn
     */
    async updateConfig(payload: any): Promise<IPlatformCostConfig> {
        let config = await PlatformCostConfig.findOne().sort({ updated_at: -1 });
        if (!config) {
            config = new PlatformCostConfig();
        }

        if (payload.fixed_costs) {
            config.fixed_costs = {
                domain_monthly: Number(payload.fixed_costs.domain_monthly ?? config.fixed_costs.domain_monthly ?? 40000),
                vps_base_monthly: Number(payload.fixed_costs.vps_base_monthly ?? config.fixed_costs.vps_base_monthly ?? 1200000),
                frontend_hosting: Number(payload.fixed_costs.frontend_hosting ?? config.fixed_costs.frontend_hosting ?? 500000),
                security_ssl: Number(payload.fixed_costs.security_ssl ?? config.fixed_costs.security_ssl ?? 260000),
            };
        }

        if (payload.unit_costs) {
            config.unit_costs = {
                storage_per_gb: Number(payload.unit_costs.storage_per_gb ?? config.unit_costs.storage_per_gb ?? 600),
                ai_per_request: Number(payload.unit_costs.ai_per_request ?? config.unit_costs.ai_per_request ?? 150),
                db_per_active_seller: Number(payload.unit_costs.db_per_active_seller ?? config.unit_costs.db_per_active_seller ?? 5000),
                payment_gateway_rate: Number(payload.unit_costs.payment_gateway_rate ?? config.unit_costs.payment_gateway_rate ?? 0.015),
                notification_per_order: Number(payload.unit_costs.notification_per_order ?? config.unit_costs.notification_per_order ?? 1000),
            };
        }

        if (payload.seller_quotas) {
            config.seller_quotas = {
                free_storage_gb: Number(payload.seller_quotas.free_storage_gb ?? config.seller_quotas.free_storage_gb ?? 1.0),
                free_ai_requests: Number(payload.seller_quotas.free_ai_requests ?? config.seller_quotas.free_ai_requests ?? 20),
                overage_markup_rate: Number(payload.seller_quotas.overage_markup_rate ?? config.seller_quotas.overage_markup_rate ?? 0.15),
            };
        }

        if (payload.policies) {
            config.policies = {
                default_commission_rate: Number(payload.policies.default_commission_rate ?? config.policies.default_commission_rate ?? 0.10),
                min_order_fee: Number(payload.policies.min_order_fee ?? config.policies.min_order_fee ?? 10000),
                max_voucher_profit_share: Number(payload.policies.max_voucher_profit_share ?? config.policies.max_voucher_profit_share ?? 0.30),
            };
        }

        config.updated_at = new Date();
        await config.save();
        logger.info('[PlatformFinance] Đã cập nhật cấu hình chi phí và chính sách sàn thành công');
        return config;
    }

    /**
     * Phân tích điểm hòa vốn CVP (Cost-Volume-Profit) 30 ngày gần nhất
     */
    async getCVPAnalysis(): Promise<CvpAnalysisResult> {
        const config = await this.getConfig();
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        // 1. Dữ liệu thực tế đơn hàng & seller
        const [activeSellersCount, deliveredOrders, totalDesignsCount] = await Promise.all([
            Shop.countDocuments(),
            OrderModel.find({
                order_status: 'DELIVERED',
                created_at: { $gte: thirtyDaysAgo },
            }).lean(),
            Design.countDocuments(),
        ]);

        // Nếu trong 30 ngày gần nhất chưa có đơn DELIVERED nào, lấy mẫu từ các đơn DELIVERED trước đó để tránh chia cho 0
        let relevantOrders = deliveredOrders;
        if (relevantOrders.length === 0) {
            relevantOrders = await OrderModel.find({ order_status: 'DELIVERED' }).limit(50).lean();
            if (relevantOrders.length === 0) {
                relevantOrders = await OrderModel.find({}).limit(50).lean();
            }
        }

        const completedOrdersCount = relevantOrders.length;
        const totalGmv = relevantOrders.reduce((sum, o) => {
            const raw = o.financial_breakdown?.subtotal;
            return sum + (raw ? Number(raw.toString()) || 0 : 0);
        }, 0);

        const actualPlatformRevenue = relevantOrders.reduce((sum, o) => {
            const raw = o.financial_breakdown?.platform_fee;
            return sum + (raw ? Number(raw.toString()) || 0 : 0);
        }, 0);

        const aov = completedOrdersCount > 0 ? Math.round(totalGmv / completedOrdersCount) : 350000;

        // 2. Chi phí cố định (Fixed Costs)
        const fcDomain = config.fixed_costs.domain_monthly || 40000;
        const fcVps = config.fixed_costs.vps_base_monthly || 1200000;
        const fcFe = config.fixed_costs.frontend_hosting || 500000;
        const fcSsl = config.fixed_costs.security_ssl || 260000;
        const baseFixedCosts = fcDomain + fcVps + fcFe + fcSsl;

        // 3. Chi phí hạ tầng bán cố định (Infrastructure Semi-fixed)
        const sellersCountSafe = Math.max(1, activeSellersCount);
        const dbSellerCost = sellersCountSafe * (config.unit_costs.db_per_active_seller || 5000);
        // Ước tính storage (2.5MB trung bình mỗi design)
        const storageGb = Math.max(0.5, Number(((totalDesignsCount * 2.5) / 1024).toFixed(2)));
        const storageCost = Math.round(storageGb * (config.unit_costs.storage_per_gb || 600));
        // Ước tính AI requests
        const estAiRequests = sellersCountSafe * 15;
        const aiCost = Math.round(estAiRequests * (config.unit_costs.ai_per_request || 150));
        const infraSubtotal = dbSellerCost + storageCost + aiCost;

        const totalFixedOverhead = baseFixedCosts + infraSubtotal;

        // 4. Biến phí trên mỗi đơn (Variable cost per order)
        const gatewayCostPerOrder = Math.round(aov * (config.unit_costs.payment_gateway_rate || 0.015));
        const notifCostPerOrder = config.unit_costs.notification_per_order || 1000;
        const variableCostPerOrder = gatewayCostPerOrder + notifCostPerOrder;

        // 5. Doanh thu trên mỗi đơn (Revenue per order & Unit Economics)
        const commissionRate = config.policies.default_commission_rate || 0.10;
        const rawRevenuePerOrder = Math.round(aov * commissionRate);
        const revenuePerOrder = Math.max(rawRevenuePerOrder, config.policies.min_order_fee || 10000);

        const contributionMarginPerOrder = revenuePerOrder - variableCostPerOrder;
        const contributionMarginRatio = revenuePerOrder > 0 ? Number((contributionMarginPerOrder / revenuePerOrder).toFixed(4)) : 0;

        // 6. Điểm hòa vốn (Break-even Point)
        let breakEvenOrders = 0;
        if (contributionMarginPerOrder > 0) {
            breakEvenOrders = Math.ceil(totalFixedOverhead / contributionMarginPerOrder);
        } else {
            breakEvenOrders = 999999; // Không thể hòa vốn nếu biến phí >= doanh thu
        }
        const breakEvenGmv = breakEvenOrders * aov;

        // 7. Tổng chi phí & Lợi nhuận thực tế trong kỳ
        const totalVariableCosts = completedOrdersCount * variableCostPerOrder;
        const totalCosts = totalFixedOverhead + totalVariableCosts;
        const netProfit = actualPlatformRevenue - totalCosts;
        const isProfitable = netProfit >= 0;

        const marginOfSafetyPct = completedOrdersCount > 0
            ? Number((((completedOrdersCount - breakEvenOrders) / completedOrdersCount) * 100).toFixed(1))
            : 0;

        return {
            period_days: 30,
            active_sellers: sellersCountSafe,
            completed_orders: completedOrdersCount,
            total_gmv: totalGmv,
            aov,
            actual_platform_revenue: actualPlatformRevenue,
            total_fixed_costs: totalFixedOverhead,
            total_variable_costs: totalVariableCosts,
            total_costs: totalCosts,
            net_profit: netProfit,
            is_profitable: isProfitable,
            break_even_orders: breakEvenOrders,
            break_even_gmv: breakEvenGmv,
            margin_of_safety_pct: marginOfSafetyPct,
            unit_economics: {
                revenue_per_order: revenuePerOrder,
                variable_cost_per_order: variableCostPerOrder,
                contribution_margin_per_order: contributionMarginPerOrder,
                contribution_margin_ratio: contributionMarginRatio,
            },
            breakdown: {
                fixed_costs: {
                    domain: fcDomain,
                    vps: fcVps,
                    frontend: fcFe,
                    ssl: fcSsl,
                    subtotal: baseFixedCosts,
                },
                infrastructure_costs: {
                    active_seller_db: dbSellerCost,
                    storage_estimated: storageCost,
                    ai_estimated: aiCost,
                    subtotal: infraSubtotal,
                },
                variable_costs: {
                    payment_gateway: gatewayCostPerOrder,
                    notification: notifCostPerOrder,
                    subtotal_per_order: variableCostPerOrder,
                },
            },
        };
    }

    /**
     * Chạy mô phỏng What-If khi Admin thay đổi Số đơn dự kiến và Tỷ lệ hoa hồng sàn
     */
    async runSimulation(
        simulatedOrdersInput: number,
        simulatedRateInput: number,
        simulatedAovInput?: number
    ): Promise<SimulationResult> {
        const config = await this.getConfig();
        const analysis = await this.getCVPAnalysis();

        const simOrders = Math.max(0, Math.round(Number(simulatedOrdersInput) || 100));
        const simRate = Math.max(0.01, Math.min(0.5, Number(simulatedRateInput) || 0.10));
        const aov = Number(simulatedAovInput) || analysis.aov || 350000;

        const fixedCost = analysis.total_fixed_costs;
        const minFee = config.policies.min_order_fee || 10000;

        // Đơn giá thu trên mỗi đơn trong kịch bản mô phỏng
        const simRevenuePerOrder = Math.max(Math.round(aov * simRate), minFee);
        const simVariableCostPerOrder = Math.round(aov * (config.unit_costs.payment_gateway_rate || 0.015)) +
            (config.unit_costs.notification_per_order || 1000);

        const unitContributionMargin = simRevenuePerOrder - simVariableCostPerOrder;

        let breakEvenOrders = 0;
        if (unitContributionMargin > 0) {
            breakEvenOrders = Math.ceil(fixedCost / unitContributionMargin);
        } else {
            breakEvenOrders = 999999;
        }
        const breakEvenGmv = breakEvenOrders * aov;

        const projectedRevenue = simOrders * simRevenuePerOrder;
        const projectedTotalCost = fixedCost + (simOrders * simVariableCostPerOrder);
        const projectedNetProfit = projectedRevenue - projectedTotalCost;
        const isProfitable = projectedNetProfit >= 0;

        const marginOfSafetyPct = simOrders > 0
            ? Number((((simOrders - breakEvenOrders) / simOrders) * 100).toFixed(1))
            : 0;

        // Sinh danh sách điểm tọa độ vẽ biểu đồ CVP (Total Revenue vs Total Cost)
        const maxQ = Math.max(
            500,
            Math.round(simOrders * 1.5),
            breakEvenOrders > 0 && breakEvenOrders < 10000 ? Math.round(breakEvenOrders * 1.6) : 600
        );
        const steps = 10;
        const stepSize = Math.max(10, Math.round(maxQ / steps));

        const chartSeries: SimulationPoint[] = [];
        for (let q = 0; q <= maxQ; q += stepSize) {
            const tr = q * simRevenuePerOrder;
            const tc = fixedCost + (q * simVariableCostPerOrder);
            chartSeries.push({
                quantity: q,
                totalRevenue: tr,
                totalCost: tc,
                fixedCost,
                netProfit: tr - tc,
            });
        }

        // Đảm bảo có điểm tại số lượng mô phỏng hiện tại nếu chưa trùng
        if (!chartSeries.some(p => p.quantity === simOrders)) {
            const tr = simOrders * simRevenuePerOrder;
            const tc = fixedCost + (simOrders * simVariableCostPerOrder);
            chartSeries.push({
                quantity: simOrders,
                totalRevenue: tr,
                totalCost: tc,
                fixedCost,
                netProfit: tr - tc,
            });
            chartSeries.sort((a, b) => a.quantity - b.quantity);
        }

        return {
            simulated_orders: simOrders,
            simulated_commission_rate: simRate,
            simulated_aov: aov,
            projected_revenue: projectedRevenue,
            projected_total_cost: projectedTotalCost,
            projected_net_profit: projectedNetProfit,
            is_profitable: isProfitable,
            break_even_orders: breakEvenOrders,
            break_even_gmv: breakEvenGmv,
            margin_of_safety_pct: marginOfSafetyPct,
            unit_contribution_margin: unitContributionMargin,
            chart_series: chartSeries,
        };
    }
}

export const platformFinanceService = new PlatformFinanceService();
