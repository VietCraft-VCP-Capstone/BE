import mongoose from 'mongoose';
import { ListingHealthScore } from '../../product/infrastructure/models/listing-health-score.model';
import { Product } from '../../product/infrastructure/models/product.model';
import { ProductVariant } from '../../product/infrastructure/models/product-variant.model';
import { Wishlist } from '../../product/infrastructure/models/wishlist.model';
import { buildMeta, insufficient, ok, Envelope } from './envelope';
import { EMPTY_SALES, SALES_WINDOW_DAYS, salesByProduct } from './listing-sales';
import { HEALTH_VERSION } from './listing-health.service';
import {
    CategoryBench, RANK_METRICS, Rank, RankInsight, RankMetric, RankMetrics, median, rankOf, rankingInsights, rate,
} from './ranking-insights';

export interface RankingItem {
    product_id: string;
    title: string;
    thumbnail: string | null;
    category: string;
    score: number | null;
    metrics: RankMetrics;
    prev: { units: number; orders: number; revenue: number; views: number; cart_rate: number | null };
    market: Record<RankMetric, Rank | null>;
    insights: RankInsight[];
}

export interface ListingRanking {
    window_days: number;
    categories: { name: string; n_mine: number; n_market: number }[];
    items: RankingItem[];
}

const LIVE = { seed_ref: { $exists: false }, is_hidden: { $ne: true } };
const OTHER = 'Khác';

const categoryOf = (p: { categories?: string[] }) => p.categories?.[0] || OTHER;

async function byId<T>(rows: Promise<({ _id: unknown } & T)[]>): Promise<Map<string, T>> {
    return new Map((await rows).map(r => [String(r._id), r]));
}

export async function listingRanking(shopId: string): Promise<{ httpStatus: number; body: Envelope<ListingRanking> | Envelope<null> }> {
    const meta = (n = 0) => buildMeta({
        scope: 'shop', scope_id: mongoose.Types.ObjectId.isValid(shopId) ? shopId : null, database: 'vietcraft',
        collection: 'product_events', mode: 'live', attributed_to_live_shop: true, sample_size: n,
    });
    if (!mongoose.Types.ObjectId.isValid(shopId)) {
        return { httpStatus: 200, body: insufficient('Cần thiết lập gian hàng thật trước khi xem bảng xếp hạng.', meta()) };
    }

    const mine = await Product.find({ shop_id: shopId, ...LIVE }).select('_id title images categories product_type').lean();
    if (!mine.length) return { httpStatus: 200, body: insufficient('Shop chưa có sản phẩm nào để xếp hạng.', meta()) };

    const cats = [...new Set(mine.map(categoryOf))];
    const others = await Product.find({ ...LIVE, shop_id: { $ne: shopId }, categories: { $in: cats } }).select('_id categories').lean();
    const market = [...mine, ...others];
    const ids = market.map(p => p._id);
    const mineIds = mine.map(p => p._id);

    const [sales, prevSales, likes, variants, scores] = await Promise.all([
        salesByProduct(ids),
        salesByProduct(mineIds, SALES_WINDOW_DAYS),
        byId<{ n: number }>(Wishlist.aggregate([
            { $match: { product_ids: { $in: ids } } },
            { $unwind: '$product_ids' },
            { $match: { product_ids: { $in: ids } } },
            { $group: { _id: '$product_ids', n: { $sum: 1 } } },
        ])),
        byId<{ price: number | null; stock: number }>(ProductVariant.aggregate([
            { $match: { product_id: { $in: ids }, is_active: { $ne: false } } },
            { $group: {
                _id: '$product_id',
                price: { $min: { $toDouble: '$retail_price' } },
                stock: { $sum: { $max: [0, { $ifNull: ['$stock_quantity', 0] }] } },
            } },
        ])),
        byId<{ score: number | null }>(ListingHealthScore.aggregate([
            { $match: { product_id: { $in: mineIds } } },
            { $sort: { date: -1, computed_at: -1 } },
            { $group: { _id: '$product_id', score: { $first: '$score' } } },
        ])),
    ]);

    const metricsOf = (id: unknown): RankMetrics => {
        const s = sales.get(String(id)) ?? EMPTY_SALES;
        return {
            views: s.views_30d, carts: s.carts_30d, orders: s.orders_30d, units: s.units_30d, revenue: s.revenue_30d,
            likes: likes.get(String(id))?.n ?? 0,
            cart_rate: rate(s.carts_30d, s.views_30d), buy_rate: rate(s.orders_30d, s.views_30d),
            price: variants.get(String(id))?.price ?? null,
        };
    };

    const byCat = new Map<string, RankMetrics[]>();
    for (const p of market) byCat.set(categoryOf(p), [...(byCat.get(categoryOf(p)) ?? []), metricsOf(p._id)]);
    const bench = new Map<string, CategoryBench>([...byCat].map(([cat, ms]) => [cat, {
        median_views: median(ms.map(m => m.views).filter(v => v > 0)) ?? 0,
        median_buy_rate: median(ms.map(m => m.buy_rate).filter((v): v is number => v !== null)),
        median_checkout: median(ms.filter(m => m.carts >= 5).map(m => m.orders / m.carts)),
        median_price: median(ms.map(m => m.price).filter((v): v is number => v !== null && v > 0)),
    }]));

    const items: RankingItem[] = mine.map(p => {
        const cat = categoryOf(p);
        const m = metricsOf(p._id);
        const peers = byCat.get(cat) ?? [];
        const ranks = Object.fromEntries(RANK_METRICS.map(k => [k, rankOf(m[k], peers.map(x => x[k]))])) as Record<RankMetric, Rank | null>;
        return {
            product_id: String(p._id),
            title: p.title,
            thumbnail: p.images?.[0] ?? null,
            category: cat,
            score: scores.get(String(p._id))?.score ?? null,
            metrics: m,
            prev: (({ units_30d, orders_30d, revenue_30d, views_30d, carts_30d }) => ({
                units: units_30d, orders: orders_30d, revenue: revenue_30d, views: views_30d, cart_rate: rate(carts_30d, views_30d),
            }))(prevSales.get(String(p._id)) ?? EMPTY_SALES),
            market: ranks,
            insights: rankingInsights(m, ranks, bench.get(cat)!, {
                category: cat,
                stock: p.product_type === 'READY_TO_SHIP' ? variants.get(String(p._id))?.stock ?? 0 : null,
                score: scores.get(String(p._id))?.score ?? null,
            }),
        };
    });

    const categories = cats.map(name => ({
        name,
        n_mine: mine.filter(p => categoryOf(p) === name).length,
        n_market: byCat.get(name)?.length ?? 0,
    }));
    return { httpStatus: 200, body: ok({ window_days: SALES_WINDOW_DAYS, categories, items }, meta(market.length)) };
}
