import { Router } from 'express';
import { PromotionService } from '../application/promotion.service';
import { Coupon } from '../infrastructure/models/coupon.model';
import { authenticate } from '../../../app/middleware/auth.middleware';

const router = Router();

// Lấy danh sách khuyến mãi sàn và shop công khai
router.get('/', async (req, res) => {
    try {
        const now = new Date();
        const filter: any = {
            is_active: true,
            start_date: { $lte: now },
            end_date: { $gte: now },
            $or: [
                { usage_limit: null },
                { $expr: { $lt: ['$used_count', '$usage_limit'] } },
            ],
        };

        if (req.query.platformOnly === 'true') {
            filter.shop_id = null;
        }

        const coupons = await Coupon.find(filter)
            .populate('shop_id', 'shop_name logo')
            .sort({ is_active: -1, end_date: 1 })
            .lean();

        const mapped = coupons.map((c: any) => ({
            ...c,
            id: c._id.toString(),
            is_platform: !c.shop_id,
            shop_name: c.shop_id?.shop_name || 'VietCraft',
            shop_logo: c.shop_id?.logo
        }));

        res.json(mapped);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải danh sách khuyến mãi.' });
    }
});

// Lấy danh sách voucher khả dụng cho Buyer tại trang Checkout
router.get('/available', authenticate, async (req, res) => {
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
router.post('/apply', authenticate, async (req, res) => {
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

