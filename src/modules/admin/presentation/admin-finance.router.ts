import { Router, Response, NextFunction } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { platformFinanceService } from '../application/platform-finance.service';
import { logger } from '../../../shared/utils/logger';

const router = Router();

// Toàn bộ các API tài chính yêu cầu xác thực và quyền ADMIN
router.use(authenticate);
router.use(requireRole(['admin']));

/**
 * GET /api/admin/finance/config
 * Lấy cấu hình chi phí và chính sách sàn hiện hành
 */
router.get('/config', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const config = await platformFinanceService.getConfig();
        res.status(200).json({ success: true, data: config });
    } catch (err: any) {
        logger.error(`[AdminFinance] Lỗi lấy config: ${err.message}`);
        next(err);
    }
});

/**
 * PUT /api/admin/finance/config
 * Cập nhật định phí, biến phí và chính sách sàn
 */
router.put('/config', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const updated = await platformFinanceService.updateConfig(req.body);
        res.status(200).json({
            success: true,
            data: updated,
            message: 'Đã cập nhật cấu hình chi phí vận hành sàn thành công.',
        });
    } catch (err: any) {
        logger.error(`[AdminFinance] Lỗi cập nhật config: ${err.message}`);
        next(err);
    }
});

/**
 * GET /api/admin/finance/cvp-analysis
 * Lấy phân tích điểm hòa vốn CVP và Unit Economics 30 ngày gần nhất
 */
router.get('/cvp-analysis', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const analysis = await platformFinanceService.getCVPAnalysis();
        res.status(200).json({ success: true, data: analysis });
    } catch (err: any) {
        logger.error(`[AdminFinance] Lỗi phân tích CVP: ${err.message}`);
        next(err);
    }
});

/**
 * POST /api/admin/finance/simulate
 * Chạy mô phỏng What-If dòng tiền và điểm hòa vốn
 * Body: { simulatedOrders: number, simulatedRate: number, simulatedAov?: number }
 */
router.post('/simulate', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { simulatedOrders, simulatedRate, simulatedAov } = req.body;
        const result = await platformFinanceService.runSimulation(
            simulatedOrders,
            simulatedRate,
            simulatedAov
        );
        res.status(200).json({ success: true, data: result });
    } catch (err: any) {
        logger.error(`[AdminFinance] Lỗi mô phỏng: ${err.message}`);
        next(err);
    }
});

export { router as adminFinanceRouter };
export default router;
