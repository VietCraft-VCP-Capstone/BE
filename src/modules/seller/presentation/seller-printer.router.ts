import { Router, Response } from 'express';
import { SellerPrinterService } from '../application/seller-printer.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

router.get('/', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const data = await SellerPrinterService.getPrinterSettings(req.user!.id);
        res.json(data);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải thông tin xưởng in.' });
    }
});

router.post('/test', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { api_url, api_key } = req.body || {};
        const result = await SellerPrinterService.testConnection(api_url, api_key);
        res.json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Kiểm tra kết nối thất bại.' });
    }
});

router.post('/connect', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await SellerPrinterService.connectPrinter(req.user!.id, req.body || {});
        res.json({ message: 'Liên kết xưởng in thành công!', printer: result });
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Lỗi khi liên kết xưởng in.' });
    }
});

router.post('/disconnect', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { printer_id } = req.body || {};
        const result = await SellerPrinterService.disconnectPrinter(req.user!.id, printer_id);
        res.json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Lỗi khi ngắt kết nối xưởng in.' });
    }
});

export const sellerPrinterRouter = router;
export default router;
