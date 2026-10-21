import mongoose, { Schema, Document } from 'mongoose';

export interface IMonthlyCost {
    /** Chỉ khoản mặc định có `key`; khoản admin tự thêm thì không. */
    key?: string;
    name: string;
    amount: number;
}

export interface IPaymentFee {
    /** Trùng `payment_method` lưu trong đơn hàng (VNPAY, PAYOS, COD, MOMO…). */
    code: string;
    name: string;
    rate: number;
    fixed: number;
}

export interface IPlatformCostConfig extends Document {
    monthly_costs: IMonthlyCost[];
    payment_fees: IPaymentFee[];
    notification_per_order: number;
    updated_at: Date;
    created_at: Date;
}

const MonthlyCostSchema = new Schema<IMonthlyCost>({
    key: { type: String },
    name: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
}, { _id: false });

const PaymentFeeSchema = new Schema<IPaymentFee>({
    code: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    rate: { type: Number, min: 0 },
    fixed: { type: Number, min: 0 },
}, { _id: false });

const PlatformCostConfigSchema = new Schema<IPlatformCostConfig>({
    monthly_costs: { type: [MonthlyCostSchema], default: undefined },
    payment_fees: { type: [PaymentFeeSchema], default: undefined },
    notification_per_order: { type: Number, min: 0 },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const PlatformCostConfig = mongoose.model<IPlatformCostConfig>(
    'PlatformCostConfig',
    PlatformCostConfigSchema,
    'platform_cost_configs'
);
