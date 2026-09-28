import { Router, Response } from 'express';
import { SellerOrdersService } from '../application/seller-orders.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

router.get('/', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const data = await SellerOrdersService.listOrders(req.user!.id, {
            status: req.query.status as string,
            search: req.query.search as string,
            page: Number(req.query.page),
            pageSize: Number(req.query.pageSize),
            sort: req.query.sort as string
        });
        res.json(data);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải danh sách đơn hàng.' });
    }
});

router.get('/:id', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const order = await SellerOrdersService.getOrder(req.user!.id, req.params.id);
        res.json(order);
    } catch (error: any) {
        res.status(404).json({ error: error.message || 'Không tìm thấy đơn hàng.' });
    }
});

router.patch('/:id/status', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const order = await SellerOrdersService.updateStatus(req.user!.id, req.params.id, req.body || {});
        res.json(order);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Không cập nhật được trạng thái đơn hàng.' });
    }
});

router.post('/:id/approve', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const order = await SellerOrdersService.approveOrder(req.user!.id, req.params.id);
        res.json({ message: 'Đã duyệt đơn hàng thành công.', order });
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Lỗi khi duyệt đơn hàng.' });
    }
});

router.post('/:id/dispatch-printer', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const order = await SellerOrdersService.dispatchOrderToPrinter(req.user!.id, req.params.id);
        res.json({ message: 'Đã duyệt đơn và gửi sang xưởng in thành công.', order });
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Lỗi khi gửi đơn hàng sang xưởng in.' });
    }
});

router.post('/:id/reject', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { reason } = req.body || {};
        const order = await SellerOrdersService.rejectOrder(req.user!.id, req.params.id, reason);
        res.json({ message: 'Đã từ chối đơn hàng.', order });
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Lỗi khi từ chối đơn hàng.' });
    }
});

export const sellerOrdersRouter = router;
export default router;

