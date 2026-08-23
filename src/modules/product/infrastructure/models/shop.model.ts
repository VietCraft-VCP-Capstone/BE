import mongoose, { Schema, Document } from 'mongoose';

export interface IBankInfo {
    bank_code: string;
    account_number: string;
    account_holder: string;
}

export interface IShop extends Document {
    owner_id: mongoose.Types.ObjectId;
    shop_name: string;
    slug: string;
    logo?: string;
    banner?: string;
    description?: string;
    return_policy?: string;
    wallet_balance: mongoose.Types.Decimal128;
    bank_info?: IBankInfo;
    average_response_time_seconds?: number;
    performance_benchmarks?: Record<string, any>;
    listing_count: number;
    average_rating: number;
    product_diversity_score?: number;
    settings?: Record<string, any>;
    created_at: Date;
    updated_at: Date;
}

const BankInfoSchema = new Schema<IBankInfo>({
    bank_code: { type: String, required: true },
    account_number: { type: String, required: true },
    account_holder: { type: String, required: true }
}, { _id: false });

const ShopSchema = new Schema<IShop>({
    owner_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    shop_name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    logo: { type: String },
    banner: { type: String },
    description: { type: String },
    return_policy: { type: String },
    wallet_balance: { type: Schema.Types.Decimal128, default: 0.0 },
    bank_info: { type: BankInfoSchema },
    average_response_time_seconds: { type: Number, default: 0 },
    performance_benchmarks: { type: Schema.Types.Mixed, default: {} },
    settings: { type: Schema.Types.Mixed, default: {} },
    listing_count: { type: Number, default: 0 },
    average_rating: { type: Number, default: 0.0 },
    product_diversity_score: { type: Number, default: 0.0 }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const Shop = mongoose.model<IShop>('Shop', ShopSchema, 'shops');
