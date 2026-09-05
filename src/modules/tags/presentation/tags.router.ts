import { Router, Response, NextFunction } from 'express';
import { tagsService } from '../application/tags.service';
import { parsePageParams } from '../../../shared/utils/pagination';
import { TagSortKey } from '../types';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

const SORT_VALUES: TagSortKey[] = ['name', 'products'];

router.get('/', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const params = parsePageParams(req.query as Record<string, unknown>);
        const rawSort = req.query.sort as string | undefined;
        const result = await tagsService.listTags(
            {
                search: req.query.search as string | undefined,
                sort: SORT_VALUES.includes(rawSort as TagSortKey) ? (rawSort as TagSortKey) : 'products',
            },
            params
        );
        res.json({ success: true, data: result });
    } catch (err: any) {
        next(err);
    }
});

router.get('/stats', authenticate, requireRole(['admin']), async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        res.json({ success: true, data: await tagsService.getTagStats() });
    } catch (err: any) {
        next(err);
    }
});

router.get('/pending', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const params = parsePageParams(req.query as Record<string, unknown>, { defaultLimit: 8, maxLimit: 50 });
        res.json({ success: true, data: await tagsService.listPendingTags(params) });
    } catch (err: any) {
        next(err);
    }
});

router.post('/:id/approve', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const tag = await tagsService.approveTag(req.params.id);
        if (!tag) return res.status(404).json({ success: false, error: 'Thẻ không tồn tại' });
        res.json({ success: true, data: tag, message: 'Đã duyệt thẻ' });
    } catch (err: any) {
        next(err);
    }
});

router.post('/:id/reject', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const ok = await tagsService.rejectTag(req.params.id);
        if (!ok) return res.status(404).json({ success: false, error: 'Thẻ không tồn tại' });
        res.json({ success: true, message: 'Đã từ chối thẻ' });
    } catch (err: any) {
        next(err);
    }
});

router.get('/:id', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const tag = await tagsService.getTagById(req.params.id);
        if (!tag) return res.status(404).json({ success: false, error: 'Thẻ không tồn tại' });
        res.json({ success: true, data: tag });
    } catch (err: any) {
        next(err);
    }
});

router.post('/', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const tag = await tagsService.createTag(req.body);
        res.status(201).json({ success: true, data: tag });
    } catch (err: any) {
        if (err.code === 11000) {
            return res.status(400).json({ success: false, error: 'Tên hoặc slug thẻ đã bị trùng' });
        }
        next(err);
    }
});

router.put('/:id', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const tag = await tagsService.updateTag(req.params.id, req.body);
        if (!tag) return res.status(404).json({ success: false, error: 'Thẻ không tồn tại' });
        res.json({ success: true, data: tag });
    } catch (err: any) {
        next(err);
    }
});

router.delete('/:id', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const ok = await tagsService.deleteTag(req.params.id);
        if (!ok) return res.status(404).json({ success: false, error: 'Thẻ không tồn tại' });
        res.json({ success: true, message: 'Đã xóa thẻ' });
    } catch (err: any) {
        if (err.message.includes('Cannot delete tag')) {
            return res.status(400).json({ success: false, error: err.message });
        }
        next(err);
    }
});

router.post('/:tagId/attach/:productId', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        await tagsService.attachTagToProduct(req.params.tagId, req.params.productId);
        res.json({ success: true, message: 'Đã gắn thẻ vào sản phẩm' });
    } catch (err: any) {
        if (err.message === 'Tag not found') return res.status(404).json({ success: false, error: 'Thẻ không tồn tại' });
        if (err.message === 'Product not found') return res.status(404).json({ success: false, error: 'Sản phẩm không tồn tại' });
        next(err);
    }
});

router.post('/:tagId/detach/:productId', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        await tagsService.detachTagFromProduct(req.params.tagId, req.params.productId);
        res.json({ success: true, message: 'Đã bỏ thẻ khỏi sản phẩm' });
    } catch (err: any) {
        if (err.message === 'Tag not found') return res.status(404).json({ success: false, error: 'Thẻ không tồn tại' });
        if (err.message === 'Product not found') return res.status(404).json({ success: false, error: 'Sản phẩm không tồn tại' });
        next(err);
    }
});

export { router as tagsRouter };

