import mongoose from 'mongoose';
import { Coupon } from '../infrastructure/models/coupon.model';
import { SavedCoupon } from '../infrastructure/models/saved-coupon.model';

export class VoucherWalletError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
}

const usable = (now: Date) => ({
    is_active: true,
    end_date: { $gte: now },
    $or: [{ usage_limit: null }, { $expr: { $lt: ['$used_count', '$usage_limit'] } }],
});

export const VoucherWalletService = {
    /** Mã còn dùng được trong ví (mã hết hạn / hết lượt tự rơi khỏi danh sách, như Shopee). */
    async list(userId: string): Promise<Array<{ couponId: string; code: string; savedAt: Date }>> {
        const saved = await SavedCoupon.find({ user_id: userId }).sort({ saved_at: -1 }).lean();
        if (saved.length === 0) return [];
        const coupons = await Coupon.find({ _id: { $in: saved.map((s: any) => s.coupon_id) }, ...usable(new Date()) }).select('code').lean();
        const codeById = new Map(coupons.map((c: any) => [String(c._id), c.code as string]));
        return saved
            .filter((s: any) => codeById.has(String(s.coupon_id)))
            .map((s: any) => ({ couponId: String(s.coupon_id), code: codeById.get(String(s.coupon_id))!, savedAt: s.saved_at }));
    },

    async save(userId: string, couponId: string) {
        if (!mongoose.Types.ObjectId.isValid(couponId)) throw new VoucherWalletError('Mã giảm giá không hợp lệ.', 400);
        const coupon: any = await Coupon.findOne({ _id: couponId, ...usable(new Date()) }).select('code').lean();
        if (!coupon) throw new VoucherWalletError('Mã giảm giá đã hết hạn hoặc hết lượt sử dụng.', 404);
        await SavedCoupon.updateOne(
            { user_id: userId, coupon_id: coupon._id },
            { $setOnInsert: { saved_at: new Date() } },
            { upsert: true },
        ).catch((err: any) => { if (err?.code !== 11000) throw err; });
        return { couponId: String(coupon._id), code: coupon.code as string };
    },

    async remove(userId: string, couponId: string) {
        if (!mongoose.Types.ObjectId.isValid(couponId)) throw new VoucherWalletError('Mã giảm giá không hợp lệ.', 400);
        await SavedCoupon.deleteOne({ user_id: userId, coupon_id: couponId });
    },
};
