import { Router, Response, NextFunction } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { platformFinanceService, parseConfigInput, parseRange } from '../application/platform-finance.service';

const router = Router();

router.use(authenticate);
router.use(requireRole(['admin']));

router.get('/config', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        res.json({ success: true, data: await platformFinanceService.getConfig() });
    } catch (err) {
        next(err);
    }
});

router.put('/config', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    let input;
    try {
        input = parseConfigInput(req.body);
    } catch (err: any) {
        return res.status(400).json({ success: false, error: err.message });
    }
    try {
        const data = await platformFinanceService.updateConfig(input);
        res.json({ success: true, data, message: 'Đã lưu cấu hình chi phí vận hành.' });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/admin/finance/pnl?days=30 hoặc ?from=YYYY-MM-DD&to=YYYY-MM-DD — báo cáo lãi lỗ của sàn trong kỳ.
 * Không đặt là /overview: router này mount trước adminRouter nên sẽ chiếm mất API của trang Thống kê thu nhập.
 */
router.get('/pnl', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    let range;
    try {
        range = parseRange(req.query);
    } catch (err: any) {
        return res.status(400).json({ success: false, error: err.message });
    }
    try {
        res.json({ success: true, data: await platformFinanceService.getOverview(range) });
    } catch (err) {
        next(err);
    }
});

export { router as adminFinanceRouter };
export default router;
