import mongoose, { Schema, Document } from 'mongoose';

export type CouponDiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING' | 'FLASH_SALE' | 'BUNDLE';
export type CouponApplicableScope = 'ALL' | 'SPECIFIC_PRODUCTS';

export interface ICoupon extends Document {
    shop_id?: mongoose.Types.ObjectId;
    code: string;
    title: string;
    description?: string;
    discount_type: CouponDiscountType;
    discount_value: mongoose.Types.Decimal128;
    min_order_value?: mongoose.Types.Decimal128;
    max_discount_amount?: mongoose.Types.Decimal128;
    usage_limit?: number;
    used_count: number;
    applicable_scope: CouponApplicableScope;
    applicable_product_ids: mongoose.Types.ObjectId[];
    start_date: Date;
    end_date: Date;
    is_active: boolean;
    created_at?: Date;
    updated_at?: Date;
}

const CouponSchema = new Schema<ICoupon>({
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', index: true, default: null },
    code: { type: String, required: true, uppercase: true, trim: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    discount_type: {
        type: String,
        required: true,
        enum: ['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING', 'FLASH_SALE', 'BUNDLE']
    },
    discount_value: { type: Schema.Types.Decimal128, required: true },
    min_order_value: { type: Schema.Types.Decimal128, default: null },
    max_discount_amount: { type: Schema.Types.Decimal128, default: null },
    usage_limit: { type: Number, default: null },
    used_count: { type: Number, required: true, default: 0 },
    applicable_scope: {
        type: String,
        enum: ['ALL', 'SPECIFIC_PRODUCTS'],
        default: 'ALL'
    },
    applicable_product_ids: [{
        type: Schema.Types.ObjectId,
        ref: 'Product',
        default: []
    }],
    start_date: { type: Date, required: true },
    end_date: { type: Date, required: true },
    is_active: { type: Boolean, required: true, default: true }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

CouponSchema.index({ code: 1, is_active: 1 });
CouponSchema.index({ shop_id: 1, is_active: 1 });

export const Coupon = mongoose.model<ICoupon>('Coupon', CouponSchema, 'coupons');

