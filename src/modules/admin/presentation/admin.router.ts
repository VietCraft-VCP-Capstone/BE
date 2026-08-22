import { Router, Request, Response, NextFunction } from 'express';
import { adminService } from '../application/admin.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import mongoose from 'mongoose';
import { logger } from '../../../shared/utils/logger';

const router = Router();

// All routes require authentication + admin role
router.use(authenticate);
router.use(requireRole(['admin']));

// ==================== CATEGORIES ====================

router.get('/categories', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { filter } = req.query;
        const categories = await adminService.listCategories(filter as string | undefined);
        res.json({ success: true, data: categories });
    } catch (err: any) {
        next(err);
    }
});

router.get('/categories/tree', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const categories = await adminService.listCategories();
        const tree = buildCategoryTree(categories as any);
        res.json({ success: true, data: tree });
    } catch (err: any) {
        next(err);
    }
});

router.get('/categories/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const category = await adminService.getCategoryById(req.params.id);
        if (!category) return res.status(404).json({ success: false, error: 'Danh mục không tồn tại' });
        res.json({ success: true, data: category });
    } catch (err: any) {
        next(err);
    }
});

router.post('/categories', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const category = await adminService.createCategory(req.body);
        res.status(201).json({ success: true, data: category });
    } catch (err: any) {
        if (err.code === 11000) {
            return res.status(400).json({ success: false, error: 'Tên hoặc slug danh mục đã bị trùng' });
        }
        next(err);
    }
});

router.put('/categories/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const category = await adminService.updateCategory(req.params.id, req.body);
        if (!category) return res.status(404).json({ success: false, error: 'Danh mục không tồn tại' });
        res.json({ success: true, data: category });
    } catch (err: any) {
        next(err);
    }
});

router.delete('/categories/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const ok = await adminService.deleteCategory(req.params.id);
        if (!ok) return res.status(404).json({ success: false, error: 'Danh mục không tồn tại' });
        res.json({ success: true, message: 'Đã xóa danh mục' });
    } catch (err: any) {
        if (err.message.includes('Cannot delete category')) {
            return res.status(400).json({ success: false, error: err.message });
        }
        next(err);
    }
});

// ==================== TAGS ====================

router.get('/tags', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const tags = await adminService.listTags();
        res.json({ success: true, data: tags });
    } catch (err: any) {
        next(err);
    }
});

// Seller-proposed tag moderation (declared before '/tags/:id' so 'pending' isn't captured as an id).
router.get('/tags/pending', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const tags = await adminService.listPendingTags();
        res.json({ success: true, data: tags });
    } catch (err: any) {
        next(err);
    }
});

router.post('/tags/:id/approve', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const tag = await adminService.approveTag(req.params.id);
        if (!tag) return res.status(404).json({ success: false, error: 'Thẻ không tồn tại' });
        res.json({ success: true, data: tag, message: 'Đã duyệt thẻ' });
    } catch (err: any) {
        next(err);
    }
});

router.post('/tags/:id/reject', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const ok = await adminService.rejectTag(req.params.id);
        if (!ok) return res.status(404).json({ success: false, error: 'Thẻ không tồn tại' });
        res.json({ success: true, message: 'Đã từ chối thẻ' });
    } catch (err: any) {
        next(err);
    }
});

router.get('/tags/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const tag = await adminService.getTagById(req.params.id);
        if (!tag) return res.status(404).json({ success: false, error: 'Thẻ không tồn tại' });
        res.json({ success: true, data: tag });
    } catch (err: any) {
        next(err);
    }
});

router.post('/tags', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const tag = await adminService.createTag(req.body);
        res.status(201).json({ success: true, data: tag });
    } catch (err: any) {
        if (err.code === 11000) {
            return res.status(400).json({ success: false, error: 'Tên hoặc slug thẻ đã bị trùng' });
        }
        next(err);
    }
});

router.put('/tags/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const tag = await adminService.updateTag(req.params.id, req.body);
        if (!tag) return res.status(404).json({ success: false, error: 'Thẻ không tồn tại' });
        res.json({ success: true, data: tag });
    } catch (err: any) {
        next(err);
    }
});

router.delete('/tags/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const ok = await adminService.deleteTag(req.params.id);
        if (!ok) return res.status(404).json({ success: false, error: 'Thẻ không tồn tại' });
        res.json({ success: true, message: 'Đã xóa thẻ' });
    } catch (err: any) {
        if (err.message.includes('Cannot delete tag')) {
            return res.status(400).json({ success: false, error: err.message });
        }
        next(err);
    }
});

router.post('/tags/:tagId/attach/:productId', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        await adminService.attachTagToProduct(req.params.tagId, req.params.productId);
        res.json({ success: true, message: 'Đã gắn thẻ vào sản phẩm' });
    } catch (err: any) {
        next(err);
    }
});

router.post('/tags/:tagId/detach/:productId', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        await adminService.detachTagFromProduct(req.params.tagId, req.params.productId);
        res.json({ success: true, message: 'Đã bỏ thẻ khỏi sản phẩm' });
    } catch (err: any) {
        next(err);
    }
});

// ==================== MODERATION ====================

router.get('/moderation/products', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
        const status = req.query.status as string | undefined; // PUBLISHED | UNPUBLISHED | DRAFT | undefined(all)
        const result = await adminService.listProducts(status, page, limit);
        res.json({ success: true, data: result });
    } catch (err: any) {
        next(err);
    }
});

router.post('/moderation/:id/unpublish', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const product = await adminService.unpublishProduct(req.params.id, req.user?.id || 'admin', req.body.reason);
        if (!product) return res.status(404).json({ success: false, error: 'Sản phẩm không tồn tại' });
        res.json({ success: true, data: product, message: 'Đã gỡ sản phẩm khỏi marketplace' });
    } catch (err: any) {
        if (err.message === 'Product not found') return res.status(404).json({ success: false, error: 'Sản phẩm không tồn tại' });
        next(err);
    }
});

router.post('/moderation/:id/republish', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const product = await adminService.republishProduct(req.params.id, req.user?.id || 'admin', req.body.notes);
        if (!product) return res.status(404).json({ success: false, error: 'Sản phẩm không tồn tại' });
        res.json({ success: true, data: product, message: 'Đã khôi phục sản phẩm' });
    } catch (err: any) {
        if (err.message === 'Product not found') return res.status(404).json({ success: false, error: 'Sản phẩm không tồn tại' });
        if (err.name === 'ValidationError') return res.status(400).json({ success: false, error: 'Validation failed', errors: err.errors });
        next(err);
    }
});

router.get('/moderation/:id/history', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const history = await adminService.getModerationHistory(req.params.id);
        res.json({ success: true, data: history });
    } catch (err: any) {
        next(err);
    }
});

router.get('/moderation/stats', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const stats = await adminService.getModerationStats();
        res.json({ success: true, data: stats });
    } catch (err: any) {
        next(err);
    }
});

// Helper: build nested category tree
function buildCategoryTree(categories: any[]): any[] {
    const map = new Map<string, any>();
    const roots: any[] = [];

    for (const cat of categories) {
        map.set(cat._id.toString(), { ...cat, children: [] });
    }

    for (const cat of categories) {
        const node = map.get(cat._id.toString());
        if (cat.parent_id) {
            const parent = map.get(cat.parent_id.toString());
            if (parent) {
                parent.children.push(node);
            } else {
                roots.push(node);
            }
        } else {
            roots.push(node);
        }
    }

    return roots.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

export { router as adminRouter };
