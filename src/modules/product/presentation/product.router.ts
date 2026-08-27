import { Router, Response } from 'express';
import { ProductsService, ValidationError, ForbiddenError, ProductActor } from '../application/product.service';
import { BlankClient } from '../application/blank-client.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

/** Map lỗi tầng service sang mã HTTP. Dùng chung cho mọi route ghi. */
function handleError(res: Response, error: any) {
    if (error instanceof ValidationError) {
        return res.status(400).json({ error: 'Dữ liệu không hợp lệ', errors: error.errors });
    }
    if (error instanceof ForbiddenError) {
        return res.status(403).json({ error: error.message });
    }
    if (/không tìm thấy|not found/i.test(error?.message || '')) {
        return res.status(404).json({ error: error.message });
    }
    return res.status(400).json({ error: error.message });
}

/** Danh tính người thao tác. Chỉ gọi sau `authenticate` nên req.user luôn có. */
function actorOf(req: AuthenticatedRequest): ProductActor {
    return { id: req.user!.id, role: req.user!.role };
}

/** Query string luôn là string — chuẩn hoá về đúng kiểu cho service. */
function filterOf(req: AuthenticatedRequest) {
    const { search, category, status, sort, page, pageSize, limit, sellerId, shopId } = req.query;
    const str = (v: any) => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
    const num = (v: any) => (v !== undefined && v !== '' && !isNaN(Number(v)) ? Number(v) : undefined);
    return {
        search: str(search),
        category: str(category),
        status: str(status),
        sort: str(sort),
        page: num(page),
        pageSize: num(pageSize),
        limit: num(limit),
        sellerId: str(sellerId),
        shopId: str(shopId),
    };
}

// ==================== ĐỌC CÔNG KHAI ====================
// Marketplace: chỉ hàng đã PUBLISHED và chưa bị ẩn.

router.get('/', async (req: AuthenticatedRequest, res) => {
    try {
        res.json(await ProductsService.getAll(filterOf(req)));
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải danh sách sản phẩm.' });
    }
});

router.get('/featured-shops', async (req, res) => {
    try {
        res.json(await ProductsService.getFeaturedShops());
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải danh sách gian hàng.' });
    }
});

// Dữ liệu tham chiếu cho form seller. Phải khai báo trước '/:id'.
router.get('/meta/categories', async (req, res) => {
    try {
        res.json(await ProductsService.listActiveCategories());
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/meta/tags', async (req, res) => {
    try {
        res.json(await ProductsService.listTags());
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== SELLER ====================

// Hàng của chính seller đang đăng nhập — kể cả bản chưa công khai.
// Thay cho cơ chế cũ dựa vào optionalAuthenticate đọc lén token ở GET '/'.
router.get('/mine', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        res.json(await ProductsService.getMine(actorOf(req), filterOf(req)));
    } catch (error: any) {
        handleError(res, error);
    }
});

// Phôi in lấy từ hệ Printer (seller chọn phôi để đè thiết kế).
router.get('/meta/blanks', authenticate, requireRole(['seller', 'admin']), async (req, res) => {
    try {
        res.json(await BlankClient.listBlanks());
    } catch (error: any) {
        res.status(502).json({ error: error.message });
    }
});

// Preview mockup (không lưu SP) — render ảnh thật gồm wrap cốc, cho bước "Xem trước".
router.post('/preview-mockup', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        const images = await ProductsService.previewMockups(
            req.user!.id,
            req.body?.blankId,
            req.body?.designPlacements || []
        );
        res.json({ images });
    } catch (error: any) {
        handleError(res, error);
    }
});

// Thao tác hàng loạt — khai báo trước '/:id' để không bị nuốt bởi route tham số.
router.post('/batch-delete', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        res.json(await ProductsService.batchDelete(req.body?.ids, actorOf(req)));
    } catch (error: any) {
        handleError(res, error);
    }
});

router.patch('/batch-status', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        const { ids, status } = req.body || {};
        res.json(await ProductsService.updateStatus(ids, status, actorOf(req)));
    } catch (error: any) {
        handleError(res, error);
    }
});

// ==================== CHI TIẾT CÔNG KHAI ====================

router.get('/:id/related', async (req, res) => {
    try {
        const product = await ProductsService.getById(req.params.id);
        res.json(await ProductsService.getRelated(req.params.id, product?.category));
    } catch (error: any) {
        res.status(404).json({ error: error.message || 'Không tìm thấy sản phẩm liên quan.' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        res.json(await ProductsService.getById(req.params.id));
    } catch (error: any) {
        res.status(404).json({ error: error.message || 'Không tìm thấy sản phẩm.' });
    }
});

// ==================== GHI (seller sở hữu / admin) ====================

router.post('/', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        res.status(201).json(await ProductsService.create(req.user!.id, req.body));
    } catch (error: any) {
        handleError(res, error);
    }
});

router.put('/:id', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        res.json(await ProductsService.update(req.params.id, actorOf(req), req.body));
    } catch (error: any) {
        handleError(res, error);
    }
});

router.delete('/:id', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        res.json(await ProductsService.delete(req.params.id, actorOf(req)));
    } catch (error: any) {
        handleError(res, error);
    }
});

export const productsRouter = router;
export default productsRouter;
