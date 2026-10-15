import mongoose, { Schema, Document } from 'mongoose';

export interface IFixedCosts {
    domain_monthly: number;
    vps_base_monthly: number;
    frontend_hosting: number;
    security_ssl: number;
}

export interface IUnitCosts {
    storage_per_gb: number;
    ai_per_request: number;
    db_per_active_seller: number;
    payment_gateway_rate: number;
    notification_per_order: number;
}

export interface ISellerQuotas {
    free_storage_gb: number;
    free_ai_requests: number;
    overage_markup_rate: number;
}

export interface IPolicies {
    default_commission_rate: number;
    min_order_fee: number;
    max_voucher_profit_share: number;
}

export interface IPlatformCostConfig extends Document {
    fixed_costs: IFixedCosts;
    unit_costs: IUnitCosts;
    seller_quotas: ISellerQuotas;
    policies: IPolicies;
    updated_at: Date;
    created_at: Date;
}

const FixedCostsSchema = new Schema<IFixedCosts>({
    domain_monthly: { type: Number, default: 40000 },
    vps_base_monthly: { type: Number, default: 1200000 },
    frontend_hosting: { type: Number, default: 500000 },
    security_ssl: { type: Number, default: 260000 },
}, { _id: false });

const UnitCostsSchema = new Schema<IUnitCosts>({
    storage_per_gb: { type: Number, default: 600 },
    ai_per_request: { type: Number, default: 150 },
    db_per_active_seller: { type: Number, default: 5000 },
    payment_gateway_rate: { type: Number, default: 0.015 },
    notification_per_order: { type: Number, default: 1000 },
}, { _id: false });

const SellerQuotasSchema = new Schema<ISellerQuotas>({
    free_storage_gb: { type: Number, default: 1.0 },
    free_ai_requests: { type: Number, default: 20 },
    overage_markup_rate: { type: Number, default: 0.15 },
}, { _id: false });

const PoliciesSchema = new Schema<IPolicies>({
    default_commission_rate: { type: Number, default: 0.10 },
    min_order_fee: { type: Number, default: 10000 },
    max_voucher_profit_share: { type: Number, default: 0.30 },
}, { _id: false });

const PlatformCostConfigSchema = new Schema<IPlatformCostConfig>({
    fixed_costs: { type: FixedCostsSchema, default: () => ({}) },
    unit_costs: { type: UnitCostsSchema, default: () => ({}) },
    seller_quotas: { type: SellerQuotasSchema, default: () => ({}) },
    policies: { type: PoliciesSchema, default: () => ({}) },
    updated_at: { type: Date, default: Date.now },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const PlatformCostConfig = mongoose.model<IPlatformCostConfig>(
    'PlatformCostConfig',
    PlatformCostConfigSchema,
    'platform_cost_configs'
);
