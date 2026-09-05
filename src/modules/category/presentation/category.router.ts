import { Router, Response, NextFunction } from 'express';
import { categoryService } from '../application/category.service';
import { parsePageParams } from '../../../shared/utils/pagination';
import { CategoryListOptions, CategoryStatusFilter } from '../types';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

const STATUS_VALUES: CategoryStatusFilter[] = ['all', 'active', 'hidden'];

function readListOptions(req: AuthenticatedRequest): CategoryListOptions {
    const raw = (req.query.status as string | undefined) ?? 'all';
    const status = STATUS_VALUES.includes(raw as CategoryStatusFilter) ? (raw as CategoryStatusFilter) : 'all';
    return {
        search: (req.query.search as string | undefined) ?? (req.query.filter as string | undefined),
        status,
    };
}

router.get('/', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const params = parsePageParams(req.query as Record<string, unknown>);
        const result = await categoryService.listCategories(readListOptions(req), params);
        res.json({ success: true, data: result });
    } catch (err: any) {
        next(err);
    }
});

router.get('/tree', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const params = parsePageParams(req.query as Record<string, unknown>, { defaultLimit: 15, maxLimit: 50 });
        const result = await categoryService.listCategoryTree(readListOptions(req), params);
        res.json({ success: true, data: result });
    } catch (err: any) {
        next(err);
    }
});

router.get('/stats', authenticate, requireRole(['admin']), async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        res.json({ success: true, data: await categoryService.getCategoryStats() });
    } catch (err: any) {
        next(err);
    }
});

router.get('/options', authenticate, requireRole(['admin']), async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        res.json({ success: true, data: await categoryService.listOptions() });
    } catch (err: any) {
        next(err);
    }
});

router.get('/:id', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const category = await categoryService.getCategoryById(req.params.id);
        if (!category) return res.status(404).json({ success: false, error: 'Danh mục không tồn tại' });
        res.json({ success: true, data: category });
    } catch (err: any) {
        next(err);
    }
});

router.post('/', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const category = await categoryService.createCategory(req.body);
        res.status(201).json({ success: true, data: category });
    } catch (err: any) {
        if (err.code === 11000) {
            return res.status(400).json({ success: false, error: 'Tên hoặc slug danh mục đã bị trùng' });
        }
        next(err);
    }
});

router.put('/:id', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const category = await categoryService.updateCategory(req.params.id, req.body);
        if (!category) return res.status(404).json({ success: false, error: 'Danh mục không tồn tại' });
        res.json({ success: true, data: category });
    } catch (err: any) {
        next(err);
    }
});

router.delete('/:id', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const ok = await categoryService.deleteCategory(req.params.id);
        if (!ok) return res.status(404).json({ success: false, error: 'Danh mục không tồn tại' });
        res.json({ success: true, message: 'Đã xóa danh mục' });
    } catch (err: any) {
        if (err.message.includes('Cannot delete category')) {
            return res.status(400).json({ success: false, error: err.message });
        }
        next(err);
    }
});

export { router as categoryRouter };
