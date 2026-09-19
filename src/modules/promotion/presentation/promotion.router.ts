import { Router } from 'express';
import { PromotionService } from '../application/promotion.service';
import { Coupon } from '../infrastructure/models/coupon.model';

const router = Router();

// Lấy danh sách khuyến mãi sàn công khai
router.get('/', async (req, res) => {
    try {
        const now = new Date();
        const coupons = await Coupon.find({
            shop_id: null,
            is_active: true,
            start_date: { $lte: now },
            end_date: { $gte: now },
            $or: [
                { usage_limit: null },
                { $expr: { $lt: ['$used_count', '$usage_limit'] } },
            ],
        }).sort({ end_date: 1 }).lean();
        res.json(coupons);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải danh sách khuyến mãi.' });
    }
});

// Lấy danh sách voucher khả dụng cho Buyer tại trang Checkout
router.get('/available', async (req, res) => {
    try {
        const shopId = req.query.shopId as string | undefined;
        const productId = req.query.productId as string | undefined;
        const subtotal = Number(req.query.subtotal) || 0;
        let items: any = undefined;
        if (req.query.items && typeof req.query.items === 'string') {
            try {
                items = JSON.parse(req.query.items);
            } catch (e) {}
        }
        const coupons = await PromotionService.getAvailableCoupons(shopId, subtotal, productId, items);
        res.json(coupons);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải danh sách voucher khả dụng.' });
    }
});

// Áp dụng mã giảm giá và tính toán số tiền giảm
router.post('/apply', async (req, res) => {
    try {
        const { code, subtotal, shippingFee, shopId, productId, items } = req.body || {};
        const result = await PromotionService.validateAndApply(
            code,
            Number(subtotal) || 0,
            Number(shippingFee) || 0,
            shopId,
            productId,
            items
        );

        if (!result.valid) {
            return res.status(400).json(result);
        }
        res.json(result);

    } catch (error: any) {
        res.status(500).json({ valid: false, discount: 0, target: 'PRODUCT', message: error.message || 'Lỗi khi áp dụng mã giảm giá.' });
    }
});

export const promotionRouter = router;
export default promotionRouter;

