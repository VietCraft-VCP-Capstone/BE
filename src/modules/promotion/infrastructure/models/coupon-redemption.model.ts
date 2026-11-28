import mongoose, { Schema } from 'mongoose';

/** Mỗi người mua chỉ được một bản ghi cho mỗi mã; chỉ mục duy nhất chặn hai request song song cùng dùng một mã. */
const CouponRedemptionSchema = new Schema({
    code: { type: String, required: true, uppercase: true, trim: true },
    buyer_id: { type: Schema.Types.ObjectId, required: true },
    created_at: { type: Date, default: Date.now },
});
CouponRedemptionSchema.index({ code: 1, buyer_id: 1 }, { unique: true });

export const CouponRedemption = mongoose.model('CouponRedemption', CouponRedemptionSchema, 'coupon_redemptions');
