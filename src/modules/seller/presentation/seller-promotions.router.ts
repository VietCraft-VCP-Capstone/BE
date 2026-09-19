import { Router, Response } from 'express';
import { PromotionService } from '../../promotion/application/promotion.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

router.use(authenticate);
router.use(requireRole(['seller', 'admin']));

// Lấy danh sách voucher của shop
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const coupons = await PromotionService.listSellerCoupons(req.user!.id);
        res.json(coupons);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải danh sách voucher của gian hàng.' });
    }
});

// Lấy danh sách sản phẩm của shop để chọn áp dụng voucher
router.get('/selectable-products', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const products = await PromotionService.getSellerSelectableProducts(req.user!.id);
        res.json(products);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải danh sách sản phẩm của gian hàng.' });
    }
});

// Tạo voucher mới cho shop
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const {
            code,
            title,
            description,
            discount_type,
            discount_value,
            min_order_value,
            max_discount_amount,
            usage_limit,
            applicable_scope,
            applicable_product_ids,
            start_date,
            end_date
        } = req.body || {};

        if (!code || !title || !discount_type || discount_value === undefined || !start_date || !end_date) {
            return res.status(400).json({ error: 'Vui lòng điền đầy đủ các thông tin bắt buộc của voucher.' });
        }

        const coupon = await PromotionService.createSellerCoupon(req.user!.id, {
            code,
            title,
            description,
            discount_type,
            discount_value: Number(discount_value),
            min_order_value: min_order_value ? Number(min_order_value) : undefined,
            max_discount_amount: max_discount_amount ? Number(max_discount_amount) : undefined,
            usage_limit: usage_limit ? Number(usage_limit) : undefined,
            applicable_scope,
            applicable_product_ids,
            start_date,
            end_date
        });

        res.status(201).json(coupon);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Không thể tạo voucher.' });
    }
});

// Bật / tắt trạng thái hoạt động của voucher
router.patch('/:id/toggle', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const updated = await PromotionService.toggleSellerCoupon(req.user!.id, req.params.id);
        res.json(updated);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Không thể cập nhật trạng thái voucher.' });
    }
});

// Xóa voucher
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await PromotionService.deleteSellerCoupon(req.user!.id, req.params.id);
        res.json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Không thể xóa voucher.' });
    }
});

export const sellerPromotionsRouter = router;
export default sellerPromotionsRouter;
