import { Router } from 'express';
import { PromotionService } from '../application/promotion.service';
import { Coupon } from '../infrastructure/models/coupon.model';
import { optionalAuthenticate, authenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { VoucherWalletService, VoucherWalletError } from '../application/voucher-wallet.service';

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
router.get('/available', optionalAuthenticate, async (req, res) => {
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
        const buyerId = (req as AuthenticatedRequest).user?.id;
        const coupons = await PromotionService.getAvailableCoupons(shopId, subtotal, productId, items, buyerId);
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
            items,
            (req as AuthenticatedRequest).user?.id
        );

        if (!result.valid) {
            return res.status(400).json(result);
        }
        res.json(result);

    } catch (error: any) {
        res.status(500).json({ valid: false, discount: 0, target: 'PRODUCT', message: error.message || 'Lỗi khi áp dụng mã giảm giá.' });
    }
});

// ── Ví voucher của tài khoản ────────────────────────────────────────────────
const walletError = (res: any, error: any) =>
    error instanceof VoucherWalletError
        ? res.status(error.status).json({ error: error.message })
        : res.status(500).json({ error: 'Không thể cập nhật ví voucher, vui lòng thử lại.' });

router.get('/saved', authenticate, async (req: AuthenticatedRequest, res) => {
    try { res.json(await VoucherWalletService.list(req.user!.id)); } catch (error) { walletError(res, error); }
});

router.post('/:id/save', authenticate, async (req: AuthenticatedRequest, res) => {
    try { res.status(201).json(await VoucherWalletService.save(req.user!.id, req.params.id)); } catch (error) { walletError(res, error); }
});

router.delete('/:id/save', authenticate, async (req: AuthenticatedRequest, res) => {
    try { await VoucherWalletService.remove(req.user!.id, req.params.id); res.status(204).end(); } catch (error) { walletError(res, error); }
});

export const promotionRouter = router;
export default promotionRouter;

