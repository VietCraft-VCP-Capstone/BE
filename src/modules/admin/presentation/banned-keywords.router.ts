import { Router, Response, NextFunction } from 'express';
import { bannedKeywordsService } from '../application/banned-keywords.service';
import { parsePageParams } from '../../../shared/utils/pagination';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

router.use(authenticate);
router.use(requireRole(['admin']));

router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const search = req.query.search as string | undefined;
        const scope = (req.query.scope as 'all' | 'custom' | 'system') || 'all';
        const params = parsePageParams(req.query as Record<string, unknown>, { defaultLimit: 20, maxLimit: 100 });
        const data = await bannedKeywordsService.list(search, params, scope);
        res.json({ success: true, data });
    } catch (err: any) {
        next(err);
    }
});

router.get('/stats', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const stats = await bannedKeywordsService.getStats();
        res.json({ success: true, data: stats });
    } catch (err: any) {
        next(err);
    }
});

router.post('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const item = await bannedKeywordsService.create(req.user!.id, req.body);
        res.status(201).json({ success: true, data: item, message: 'Đã thêm từ khóa cấm thành công' });
    } catch (err: any) {
        res.status(400).json({ success: false, error: err.message || 'Không thể thêm từ khóa cấm' });
    }
});

router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const ok = await bannedKeywordsService.delete(req.params.id);
        if (!ok) return res.status(404).json({ success: false, error: 'Từ khóa không tồn tại' });
        res.json({ success: true, message: 'Đã xóa từ khóa cấm' });
    } catch (err: any) {
        next(err);
    }
});

router.post('/seed', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const result = await bannedKeywordsService.seedSystemKeywords(req.user!.id);
        res.json({ success: true, ...result, message: `Đã khởi tạo ${result.added} từ khóa hệ thống mẫu` });
    } catch (err: any) {
        next(err);
    }
});

export const bannedKeywordsRouter = router;
