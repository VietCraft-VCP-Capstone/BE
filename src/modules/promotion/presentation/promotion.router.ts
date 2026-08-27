import { Router } from 'express';
import { Coupon } from '../infrastructure/models/coupon.model';

const router = Router();

// GET /promotions - Mã giảm giá công khai đang còn hiệu lực.
// Trước đây trả Coupon.find({}) = lộ cả coupon riêng của shop lẫn coupon đã hết hạn/hết lượt.
router.get('/', async (req, res) => {
    try {
        const now = new Date();
        const coupons = await Coupon.find({
            shop_id: null,                       // null khớp cả document không có field shop_id
            start_date: { $lte: now },
            end_date: { $gte: now },
            $or: [
                { usage_limit: null },           // không giới hạn lượt dùng
                { $expr: { $lt: ['$used_count', '$usage_limit'] } },
            ],
        }).sort({ end_date: 1 }).lean();
        res.json(coupons);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const promotionRouter = router;
export default promotionRouter;
