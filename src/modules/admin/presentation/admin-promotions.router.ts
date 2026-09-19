import { Router, Response } from 'express';
import { PromotionService } from '../../promotion/application/promotion.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

router.use(authenticate);
router.use(requireRole(['admin']));

// Lấy danh sách toàn bộ voucher trên sàn
router.get('/', async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const coupons = await PromotionService.listAdminCoupons();
        res.json(coupons);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải danh sách voucher toàn sàn.' });
    }
});

// Lấy danh sách sản phẩm toàn sàn để chọn áp dụng voucher
router.get('/selectable-products', async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const products = await PromotionService.getAdminSelectableProducts();
        res.json(products);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải danh sách sản phẩm toàn sàn.' });
    }
});

// Tạo voucher sàn mới
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
            end_date,
            shop_id
        } = req.body || {};

        if (!code || !title || !discount_type || discount_value === undefined || !start_date || !end_date) {
            return res.status(400).json({ error: 'Vui lòng điền đầy đủ các thông tin bắt buộc của voucher sàn.' });
        }

        const coupon = await PromotionService.createAdminCoupon({
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
            end_date,
            shop_id: shop_id || null
        });

        res.status(201).json(coupon);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Không thể tạo voucher sàn.' });
    }
});

// Bật / tắt trạng thái hoạt động của voucher
router.patch('/:id/toggle', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const updated = await PromotionService.toggleAdminCoupon(req.params.id);
        res.json(updated);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Không thể cập nhật trạng thái voucher.' });
    }
});

// Xóa voucher
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await PromotionService.deleteAdminCoupon(req.params.id);
        res.json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Không thể xóa voucher.' });
    }
});

export const adminPromotionsRouter = router;
export default adminPromotionsRouter;
