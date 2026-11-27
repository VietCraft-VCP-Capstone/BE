import mongoose, { Schema, Document } from 'mongoose';

/** Ví voucher: mã người dùng đã bấm "Lưu" — gắn với tài khoản, dùng được trên mọi thiết bị. */
export interface ISavedCoupon extends Document {
    user_id: mongoose.Types.ObjectId;
    coupon_id: mongoose.Types.ObjectId;
    saved_at: Date;
}

const SavedCouponSchema = new Schema<ISavedCoupon>({
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    coupon_id: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
    saved_at: { type: Date, default: Date.now },
}, { collection: 'saved_coupons' });

SavedCouponSchema.index({ user_id: 1, coupon_id: 1 }, { unique: true });

export const SavedCoupon = mongoose.models.SavedCoupon
    || mongoose.model<ISavedCoupon>('SavedCoupon', SavedCouponSchema);
