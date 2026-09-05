import { Router } from 'express';
import { Coupon } from '../infrastructure/models/coupon.model';

const router = Router();

router.get('/', async (req, res) => {
    try {
        const now = new Date();
        const coupons = await Coupon.find({
            shop_id: null,
            start_date: { $lte: now },
            end_date: { $gte: now },
            $or: [
                { usage_limit: null },
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
