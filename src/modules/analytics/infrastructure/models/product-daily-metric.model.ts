import mongoose, { Schema, Document } from 'mongoose';

export interface IProductDailyMetric extends Document {
    product_id: mongoose.Types.ObjectId;
    date: Date;
    views: number;
    add_to_carts: number;
    favorited_count: number;
    orders_count: number;
    revenue: mongoose.Types.Decimal128;
    anomaly_detected: boolean;
    anomaly_z_score: number;
    created_at?: Date;
    updated_at?: Date;
}

const ProductDailyMetricSchema = new Schema<IProductDailyMetric>({
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    date: { type: Date, required: true, index: true },
    views: { type: Number, default: 0 },
    add_to_carts: { type: Number, default: 0 },
    favorited_count: { type: Number, default: 0 },
    orders_count: { type: Number, default: 0 },
    revenue: { type: Schema.Types.Decimal128, default: 0.0 },
    anomaly_detected: { type: Boolean, default: false },
    anomaly_z_score: { type: Number, default: 0.0 },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
}, {
    timestamps: false
});

// Unique index for upsert operations
ProductDailyMetricSchema.index({ product_id: 1, date: 1 }, { unique: true });
ProductDailyMetricSchema.index({ product_id: 1, date: -1 });
ProductDailyMetricSchema.index({ updated_at: 1 }, { expireAfterSeconds: 15552000 }); // TTL: 180 days

export const ProductDailyMetric = mongoose.model<IProductDailyMetric>('ProductDailyMetric', ProductDailyMetricSchema, 'product_daily_metrics');
