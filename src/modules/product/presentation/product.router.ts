import { Router } from 'express';
import { ProductsService } from '../application/product.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

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

router.get('/:id/related', async (req, res) => {
    try {
        const product = await ProductsService.getById(req.params.id);
        const related = await ProductsService.getRelated(req.params.id, product.category);
        res.json(related);
    } catch (error: any) {
        res.status(404).json({ error: error.message });
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
        res.status(400).json({ error: error.message });
    }
});

router.put('/:id', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        const sellerId = req.user!.id;
        const updated = await ProductsService.update(req.params.id, sellerId, req.body);
        res.json(updated);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

router.delete('/:id', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        const sellerId = req.user!.id;
        const status = await ProductsService.delete(req.params.id, sellerId);
        res.json(status);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

export const productsRouter = router;
export default productsRouter;
