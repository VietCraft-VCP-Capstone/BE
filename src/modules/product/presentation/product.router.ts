import { Router } from 'express';
import { ProductsService } from '../application/product.service';
import { optionalAuthenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

// GET all products with optional filters and seller isolation
router.get('/', optionalAuthenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const { search, category, status, sort, page, pageSize, sellerId } = req.query;
        const resolvedSellerId = (req.user?.role?.toUpperCase() === 'SELLER' ? req.user.id : undefined)
            || (typeof sellerId === 'string' ? sellerId : undefined);

        const products = await ProductsService.getAll({
            search: typeof search === 'string' ? search : undefined,
            category: typeof category === 'string' ? category : undefined,
            status: typeof status === 'string' ? status : undefined,
            sort: typeof sort === 'string' ? sort : undefined,
            page: page ? Number(page) : undefined,
            pageSize: pageSize ? Number(pageSize) : undefined,
            sellerId: resolvedSellerId,
        });
        res.json(products);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải danh sách sản phẩm.' });
    }
});

// GET featured shops for landing page & storefronts
router.get('/featured-shops', async (req, res) => {
    try {
        const shops = await ProductsService.getFeaturedShops();
        res.json(shops);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải danh sách gian hàng.' });
    }
});

// GET single product by ID
router.get('/:id', async (req, res) => {
    try {
        const product = await ProductsService.getById(req.params.id);
        res.json(product);
    } catch (error: any) {
        res.status(404).json({ error: error.message || 'Không tìm thấy sản phẩm.' });
    }
});

// POST create product
router.post('/', optionalAuthenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const sellerId = req.user?.id || '65c2f0000000000000000001';
        const newProduct = await ProductsService.create(sellerId, req.body);
        res.status(201).json(newProduct);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Không thể tạo sản phẩm mới.' });
    }
});

// POST batch delete
router.post('/batch-delete', optionalAuthenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const sellerId = req.user?.id || '65c2f0000000000000000001';
        const { ids } = req.body;
        const result = await ProductsService.batchDelete(ids, sellerId);
        res.json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Lỗi khi xóa hàng loạt sản phẩm.' });
    }
});

// PATCH batch update status
router.patch('/batch-status', optionalAuthenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const sellerId = req.user?.id || '65c2f0000000000000000001';
        const { ids, status } = req.body;
        const result = await ProductsService.updateStatus(ids, status, sellerId);
        res.json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Lỗi khi cập nhật trạng thái sản phẩm.' });
    }
});

// PUT update product
router.put('/:id', optionalAuthenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const sellerId = req.user?.id || '65c2f0000000000000000001';
        const updated = await ProductsService.update(req.params.id, sellerId, req.body);
        res.json(updated);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Không thể cập nhật sản phẩm.' });
    }
});

// DELETE single product
router.delete('/:id', optionalAuthenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const sellerId = req.user?.id || '65c2f0000000000000000001';
        const status = await ProductsService.delete(req.params.id, sellerId);
        res.json(status);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Không thể xóa sản phẩm.' });
    }
});

export const productsRouter = router;
export default productsRouter;
