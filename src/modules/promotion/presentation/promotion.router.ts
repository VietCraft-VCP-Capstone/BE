import { Router } from 'express';
import { Coupon } from '../infrastructure/models/coupon.model';

const router = Router();

// GET /promotions - Retrieve all coupon promotions
router.get('/', async (req, res) => {
    try {
        const coupons = await Coupon.find({});
        res.json(coupons);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const promotionRouter = router;
export default promotionRouter;
