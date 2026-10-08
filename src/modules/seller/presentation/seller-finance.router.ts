import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { SellerFinanceService } from '../application/seller-finance.service';
import { logger } from '../../../shared/utils/logger';

const router = Router();

/**
 * GET /api/seller/finance/overview
 * Lấy tổng quan số dư, doanh thu, dòng tiền của shop
 */
router.get('/overview', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const ownerId = req.user?.id;
        if (!ownerId) {
            res.status(401).json({ success: false, message: 'Yêu cầu đăng nhập tài khoản người bán.' });
            return;
        }

        const data = await SellerFinanceService.getOverview(ownerId);
        res.json({ success: true, data });
    } catch (err: any) {
        logger.error(`[SellerFinance] Lỗi getOverview: ${err?.message}`);
        res.status(500).json({ success: false, message: err?.message || 'Lỗi khi tải thông tin tài chính' });
    }
});

/**
 * GET /api/seller/finance/settlements
 * Lấy danh sách các phiên đối soát đơn hàng
 */
router.get('/settlements', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const ownerId = req.user?.id;
        if (!ownerId) {
            res.status(401).json({ success: false, message: 'Yêu cầu đăng nhập tài khoản người bán.' });
            return;
        }

        const { page, limit, status, search } = req.query;
        const result = await SellerFinanceService.getSettlements(ownerId, {
            page: page ? Number(page) : 1,
            limit: limit ? Number(limit) : 15,
            status: status as string,
            search: search as string,
        });

        res.json({ success: true, ...result });
    } catch (err: any) {
        logger.error(`[SellerFinance] Lỗi getSettlements: ${err?.message}`);
        res.status(500).json({ success: false, message: err?.message || 'Lỗi khi tải danh sách đối soát' });
    }
});

/**
 * GET /api/seller/finance/withdrawals
 * Lấy lịch sử các lệnh rút tiền
 */
router.get('/withdrawals', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const ownerId = req.user?.id;
        if (!ownerId) {
            res.status(401).json({ success: false, message: 'Yêu cầu đăng nhập tài khoản người bán.' });
            return;
        }

        const { page, limit, status } = req.query;
        const result = await SellerFinanceService.getWithdrawals(ownerId, {
            page: page ? Number(page) : 1,
            limit: limit ? Number(limit) : 15,
            status: status as string,
        });

        res.json({ success: true, ...result });
    } catch (err: any) {
        logger.error(`[SellerFinance] Lỗi getWithdrawals: ${err?.message}`);
        res.status(500).json({ success: false, message: err?.message || 'Lỗi khi tải lịch sử rút tiền' });
    }
});

/**
 * POST /api/seller/finance/withdraw
 * Tạo yêu cầu rút tiền về tài khoản ngân hàng
 */
router.post('/withdraw', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const ownerId = req.user?.id;
        if (!ownerId) {
            res.status(401).json({ success: false, message: 'Yêu cầu đăng nhập tài khoản người bán.' });
            return;
        }

        const { amount, bank } = req.body;
        if (!amount || typeof amount !== 'number' || amount < 500) {
            res.status(400).json({ success: false, message: 'Số tiền rút tối thiểu là 500 VNĐ.' });
            return;
        }

        const result = await SellerFinanceService.requestWithdrawal(ownerId, Math.round(amount), bank);
        res.json({ success: true, data: result, message: 'Yêu cầu rút tiền thành công!' });
    } catch (err: any) {
        logger.error(`[SellerFinance] Lỗi requestWithdrawal: ${err?.message}`);
        res.status(400).json({ success: false, message: err?.message || 'Không thể tạo yêu cầu rút tiền' });
    }
});

export default router;
export { router as sellerFinanceRouter };
