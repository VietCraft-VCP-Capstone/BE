import { Router } from 'express';
import { ProductsService, ValidationError, ForbiddenError } from '../application/product.service';
import { BlankClient } from '../application/blank-client.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

/** Map service errors to HTTP responses (shared by all write routes). */
function handleError(res: any, error: any) {
    if (error instanceof ValidationError) {
        return res.status(400).json({ error: 'Validation failed', errors: error.errors });
    }
    if (error instanceof ForbiddenError) {
        return res.status(403).json({ error: error.message });
    }
    if (error.message === 'Product not found') {
        return res.status(404).json({ error: error.message });
    }
    return res.status(400).json({ error: error.message });
}

router.get('/', async (req, res) => {
    try {
        const products = await ProductsService.getAll();
        res.json(products);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/featured-shops', async (req, res) => {
    try {
        const shops = await ProductsService.getFeaturedShops();
        res.json(shops);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Reference data for the seller product form (must be declared before '/:id').
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
        const images = await ProductsService.previewMockups(req.user!.id, req.body?.blankId, req.body?.designPlacements || []);
        res.json({ images });
    } catch (error: any) {
        handleError(res, error);
    }
});

router.get('/:id', async (req, res) => {
    try {
        const product = await ProductsService.getById(req.params.id);
        res.json(product);
    } catch (error: any) {
        res.status(404).json({ error: error.message });
    }
});

router.post('/', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        const sellerId = req.user!.id;
        const newProduct = await ProductsService.create(sellerId, req.body);
        res.status(201).json(newProduct);
    } catch (error: any) {
        handleError(res, error);
    }
});

router.put('/:id', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        const updated = await ProductsService.update(req.params.id, req.user!, req.body);
        res.json(updated);
    } catch (error: any) {
        handleError(res, error);
    }
});

router.delete('/:id', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        const status = await ProductsService.delete(req.params.id, req.user!);
        res.json(status);
    } catch (error: any) {
        handleError(res, error);
    }
});

export const productsRouter = router;
export default productsRouter;
