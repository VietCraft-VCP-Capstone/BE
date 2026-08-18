import mongoose, { Schema, Document } from 'mongoose';

export interface ICoupon extends Document {
    shop_id?: mongoose.Types.ObjectId;
    code: string;
    discount_type: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FLASH_SALE' | 'BUNDLE';
    discount_value: mongoose.Types.Decimal128;
    min_order_value?: mongoose.Types.Decimal128;
    max_discount_amount?: mongoose.Types.Decimal128;
    usage_limit?: number;
    used_count: number;
    start_date: Date;
    end_date: Date;
}

const CouponSchema = new Schema<ICoupon>({
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', index: true },
    code: { type: String, required: true, index: true },
    discount_type: {
        type: String,
        required: true,
        enum: ['PERCENTAGE', 'FIXED_AMOUNT', 'FLASH_SALE', 'BUNDLE']
    },
    discount_value: { type: Schema.Types.Decimal128, required: true },
    min_order_value: { type: Schema.Types.Decimal128 },
    max_discount_amount: { type: Schema.Types.Decimal128 },
    usage_limit: { type: Number },
    used_count: { type: Number, required: true, default: 0 },
    start_date: { type: Date, required: true },
    end_date: { type: Date, required: true }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const Coupon = mongoose.model<ICoupon>('Coupon', CouponSchema, 'coupons');
