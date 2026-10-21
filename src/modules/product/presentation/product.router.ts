import { Router, Response } from 'express';
import { ProductsService, ValidationError, ForbiddenError, ProductActor } from '../application/product.service';
import { SearchProductsParams } from '../application/product.dto';
import { BlankClient } from '../application/blank-client.service';
import { parseSearchClick, recordSearchClick } from '../application/search-click';
import { authenticate, requireRole, optionalAuthenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { ReviewService } from '../../order';
import { RecommendService } from '../application/recommend/recommend.service';
import { nfcLower } from '../../../shared/utils/vietnamese-search.util';
import { getRecentSearches, addRecentSearch, clearRecentSearches } from '../application/recent-searches';

const router = Router();

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

function actorOf(req: AuthenticatedRequest): ProductActor {
    return { id: req.user!.id, role: req.user!.role };
}

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


router.get('/', async (req: AuthenticatedRequest, res) => {
    try {
        res.json(await ProductsService.getAll(filterOf(req)));
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải danh sách sản phẩm.' });
    }
});

router.get('/search', optionalAuthenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const {
            q, search, category, productType, craftType, location,
            rating, minPrice, maxPrice, sort, page, pageSize, limit, inStockOnly
        } = req.query;

        const str = (v: any) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
        const num = (v: any) => (v !== undefined && v !== '' && !isNaN(Number(v)) ? Number(v) : undefined);
        const bool = (v: any) => (v === 'true' || v === true);

        const params: SearchProductsParams = {
            q: str(q || search),
            category: str(category),
            productType: str(productType),
            craftType: str(craftType),
            location: str(location),
            rating: num(rating),
            minPrice: num(minPrice),
            maxPrice: num(maxPrice),
            sort: str(sort),
            page: num(page),
            pageSize: num(pageSize),
            limit: num(limit),
            inStockOnly: bool(inStockOnly),
            userId: req.user?.id
        };

        res.json(await ProductsService.search(params));
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tìm kiếm sản phẩm.' });
    }
});

router.post('/search/click', async (req, res) => {
    const click = parseSearchClick(req.body);
    if (!click) return res.status(400).json({ error: 'Dữ liệu click không hợp lệ' });
    try {
        await recordSearchClick(click);
        res.status(204).end();
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi ghi nhận click.' });
    }
});

router.get('/suggest', optionalAuthenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const q = typeof req.query.q === 'string' ? req.query.q : (typeof req.query.search === 'string' ? req.query.search : '');
        res.json(await ProductsService.suggest(q, req.user?.id));
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi lấy gợi ý tìm kiếm.' });
    }
});

router.get('/featured-shops', async (req, res) => {
    try {
        res.json(await ProductsService.getFeaturedShops());
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải danh sách gian hàng.' });
    }
});

router.get('/meta/categories', async (req, res) => {
    try {
        res.json(await ProductsService.listActiveCategories());
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/meta/trending-keywords', async (req, res) => {
    try {
        const limit = Number(req.query.limit) || 8;
        res.json(await ProductsService.getTrendingKeywords(limit));
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi lấy từ khóa thịnh hành.' });
    }
});

router.get('/meta/tags', async (req, res) => {
    try {
        res.json(await ProductsService.listTags());
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// shortcut: q/q[] chỉ lấy chuỗi, tối đa 3 từ khoá, mỗi từ 50 ký tự
function forYouKeywords(req: AuthenticatedRequest): string[] {
    return [req.query.q, req.query['q[]']].flat()
        .filter((v): v is string => typeof v === 'string')
        .map(v => nfcLower(v).slice(0, 50).trim())
        .filter(Boolean)
        .slice(0, 3);
}

router.get('/meta/recent-searches', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        res.json(await getRecentSearches(req.user!.id));
    } catch (error: any) {
        handleError(res, error);
    }
});

router.post('/meta/recent-searches', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const keyword = req.body?.keyword;
        if (typeof keyword !== 'string' || !keyword.trim()) {
            return res.status(400).json({ error: 'Thiếu từ khoá' });
        }
        res.json(await addRecentSearch(req.user!.id, keyword));
    } catch (error: any) {
        handleError(res, error);
    }
});

router.delete('/meta/recent-searches', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        await clearRecentSearches(req.user!.id);
        res.status(204).end();
    } catch (error: any) {
        handleError(res, error);
    }
});

router.get('/meta/for-you', optionalAuthenticate, async (req: AuthenticatedRequest, res) => {
    try {
        const sid = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim().slice(0, 100) : '';
        res.json(await RecommendService.forYou({
            userId: req.user?.id,
            sessionId: sid || undefined,
            limit: Math.min(24, Math.max(1, Math.floor(Number(req.query.limit)) || 8)),
            q: forYouKeywords(req),
        }));
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Lỗi khi tải gợi ý sản phẩm.' });
    }
});

// ==================== SELLER ====================

router.get('/mine', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        res.json(await ProductsService.getMine(actorOf(req), filterOf(req)));
    } catch (error: any) {
        handleError(res, error);
    }
});

router.get('/meta/blanks', authenticate, requireRole(['seller', 'admin']), async (req: any, res) => {
    try {
        const sellerId = req.user?.id;
        res.json(await BlankClient.listBlanks(sellerId));
    } catch (error: any) {
        res.status(502).json({ error: error.message });
    }
});

router.post('/preview-mockup', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        const result = await ProductsService.previewMockups(
            req.user!.id,
            req.body?.blankId,
            req.body?.designPlacements || [],
            {
                colorHex: req.body?.colorHex,
                colors: req.body?.colors
            }
        );
        res.json(result);
    } catch (error: any) {
        handleError(res, error);
    }
});
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

router.get('/:id/reviews', async (req, res) => {
    try {
        const { page, limit, rating } = req.query;
        const result = await ReviewService.getProductReviews(req.params.id, {
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
            rating: rating ? Number(rating) : undefined,
        });
        res.json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Lỗi khi tải danh sách đánh giá.' });
    }
});

router.get('/:id/related', async (req, res) => {
    try {
        const limit = req.query.limit ? Number(req.query.limit) : 4;
        const category = req.query.category as string | undefined;
        res.json(await ProductsService.getRelated(req.params.id, category, limit));
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
