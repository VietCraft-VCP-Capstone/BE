import mongoose from 'mongoose';
import { Product } from '../../product/infrastructure/models/product.model';
import { Tag } from '../../tags/infrastructure/models/tag.model';
import { ListingHealthScore, IAxis, ITodo, IConversionDetail } from '../../product/infrastructure/models/listing-health-score.model';
import { buildMeta, ok, insufficient, Envelope } from './envelope';
import { EMPTY_SALES, HealthInputs, ListingProductInfo, ListingSales, healthInputs, salesByProduct } from './listing-sales';


const COLLECTION = 'listing_health_scores';
export const HEALTH_VERSION = 'health-2.2';
const MODEL_VERSION_FALLBACK = HEALTH_VERSION;

export type HealthStatus = 'good' | 'needs_improvement' | 'poor';

export interface HealthDetailData {
    product_id: string;
    title: string | null;
    score: number | null;
    status: HealthStatus | null;
    axes: IAxis;
    axes_missing: string[];
    todos: ITodo[];
    conversion_detail: IConversionDetail | null;
    inputs: HealthInputs;
    product: ListingProductInfo;
    sales: ListingSales;
}

export interface HealthListItem {
    product_id: string;
    title: string;
    thumbnail: string | null;
    score: number | null;
    status: HealthStatus | null;
    axes: IAxis;
    axes_missing: string[];
    computed_at: string | null;
    todos: ITodo[];
    n_todos: number;
    warnings: ITodo[];
    tags: { name: string; pending: boolean }[];
    sales: ListingSales;
}

export interface HealthHistoryPoint {
    date: string;
    score: number;
    status: HealthStatus | null;
    axes: IAxis;
}

export interface HealthListData {
    items: HealthListItem[];
    total: number;
}

function metaForListing(productId: string, opts: {
    computed_at?: Date | string | null;
    model_version?: string;
    confidence?: string;
}): ReturnType<typeof buildMeta> {
    return buildMeta({
        computed_at: opts.computed_at ?? undefined,
        model_version: opts.model_version || MODEL_VERSION_FALLBACK,
        scope: 'listing',
        scope_id: productId,
        database: 'vietcraft',
        collection: COLLECTION,
        mode: 'live',
        attributed_to_live_shop: true,
        confidence: opts.confidence,
    });
}

type OwnedProduct = {
    _id: mongoose.Types.ObjectId;
    title?: string;
    images?: string[];
    description?: string;
    tags?: string[];
    tag_ids?: mongoose.Types.ObjectId[];
    product_type?: string;
    updated_at?: Date;
};

export class ListingHealthService {
    static isValidObjectId(value: unknown): value is string {
        return typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);
    }

    static async ownedProduct(productId: string, shopId: string): Promise<
        | { product: OwnedProduct }
        | { denied: { httpStatus: number; body: { error: string; resource?: string } } }
    > {
        const product = await Product.findById(productId)
            .select('_id shop_id title images description tags tag_ids product_type updated_at')
            .lean();
        if (!product) {
            return { denied: { httpStatus: 404, body: { error: 'not_found', resource: 'listing' } } };
        }
        if (String(product.shop_id) !== shopId) {
            return { denied: { httpStatus: 403, body: { error: 'forbidden' } } };
        }
        return { product: product as OwnedProduct };
    }

    static async detail(productId: string, shopId: string): Promise<{ httpStatus: number; body: Envelope<HealthDetailData> | { error: string; field?: string; resource?: string } }> {
        if (!this.isValidObjectId(productId)) {
            return { httpStatus: 400, body: { error: 'invalid_param', field: 'id' } };
        }

        if (!this.isValidObjectId(shopId)) {
            return {
                httpStatus: 200,
                body: insufficient(
                    'Cần thiết lập gian hàng thật trước khi xem điểm sức khoẻ listing.',
                    metaForListing(productId, {}),
                ),
            };
        }

        const owned = await this.ownedProduct(productId, shopId);
        if ('denied' in owned) return owned.denied;
        const { product } = owned;

        const record = await ListingHealthScore.findOne({ product_id: product._id })
            .sort({ date: -1 })
            .lean();

        if (!record || record.score === null || record.score === undefined) {
            return {
                httpStatus: 200,
                body: insufficient(
                    'Chưa đủ dữ liệu để chấm điểm sức khoẻ cho sản phẩm này.',
                    metaForListing(productId, {
                        computed_at: record?.computed_at ?? null,
                        model_version: record?.model_version,
                        confidence: 'low',
                    }),
                ),
            };
        }

        const [{ inputs, info }, sales] = await Promise.all([
            healthInputs(product, record.content_changed_at),
            salesByProduct([product._id]),
        ]);
        const data: HealthDetailData = {
            product_id: productId,
            title: product.title ?? null,
            score: record.score,
            status: record.status as HealthStatus | null,
            axes: record.axes || {},
            axes_missing: record.axes_missing || [],
            todos: record.todos || [],
            conversion_detail: record.conversion_detail ?? null,
            inputs,
            product: info,
            sales: sales.get(String(product._id)) ?? { ...EMPTY_SALES },
        };

        return {
            httpStatus: 200,
            body: ok(data, metaForListing(productId, {
                computed_at: record.computed_at,
                model_version: record.model_version,
                confidence: (record.axes_missing || []).length > 0 ? 'medium' : 'high',
            })),
        };
    }

    static async history(productId: string, shopId: string, days: number): Promise<{ httpStatus: number; body: Envelope<HealthHistoryPoint[]> | { error: string; field?: string; resource?: string } }> {
        if (!this.isValidObjectId(productId)) {
            return { httpStatus: 400, body: { error: 'invalid_param', field: 'id' } };
        }
        if (!this.isValidObjectId(shopId)) {
            return {
                httpStatus: 200,
                body: insufficient(
                    'Cần thiết lập gian hàng thật trước khi xem lịch sử điểm sức khoẻ.',
                    metaForListing(productId, {}),
                ),
            };
        }

        const owned = await this.ownedProduct(productId, shopId);
        if ('denied' in owned) return owned.denied;

        const since = new Date();
        since.setUTCHours(0, 0, 0, 0);
        since.setUTCDate(since.getUTCDate() - (days - 1));

        const rows = await ListingHealthScore.find({
            product_id: owned.product._id,
            model_version: HEALTH_VERSION,
            date: { $gte: since },
            score: { $ne: null },
        })
            .select('date score status axes model_version computed_at')
            .sort({ date: 1 })
            .lean();

        const points: HealthHistoryPoint[] = rows.map(r => ({
            date: new Date(r.date).toISOString().slice(0, 10),
            score: r.score as number,
            status: (r.status as HealthStatus | null) ?? null,
            axes: r.axes || {},
        }));
        const latest = rows[rows.length - 1];
        const meta = buildMeta({
            computed_at: latest?.computed_at ?? null,
            model_version: latest?.model_version || MODEL_VERSION_FALLBACK,
            scope: 'listing',
            scope_id: productId,
            database: 'vietcraft',
            collection: COLLECTION,
            mode: 'live',
            attributed_to_live_shop: true,
            sample_size: points.length,
        });

        if (points.length < 2) {
            return {
                httpStatus: 200,
                body: insufficient('Cần ít nhất 2 ngày có điểm để vẽ lịch sử.', meta),
            };
        }
        return { httpStatus: 200, body: ok(points, meta) };
    }

    static async list(shopId: string, statusFilter?: HealthStatus): Promise<{ httpStatus: number; body: Envelope<HealthListData> | { error: string; field?: string; expected?: string } }> {
        if (!this.isValidObjectId(shopId)) {
            return {
                httpStatus: 200,
                body: insufficient(
                    'Cần thiết lập gian hàng thật trước khi xem điểm sức khoẻ listing.',
                    buildMeta({ scope: 'shop', scope_id: null, database: 'vietcraft', collection: COLLECTION, mode: 'live' }),
                ),
            };
        }

        const products = await Product.find({ shop_id: shopId, seed_ref: { $exists: false }, is_hidden: { $ne: true } })
            .select('_id title images tags tag_ids')
            .lean();

        const productIds = products.map(p => p._id);

        const latestByProduct = new Map<string, { score: number | null; status: HealthStatus | null; axes: IAxis; axes_missing: string[]; computed_at: Date | string | null; model_version?: string; todos: ITodo[] }>();

        if (productIds.length > 0) {
            const rows = await ListingHealthScore.aggregate([
                { $match: { product_id: { $in: productIds } } },
                { $sort: { date: -1, computed_at: -1 } },
                {
                    $group: {
                        _id: '$product_id',
                        score: { $first: '$score' },
                        status: { $first: '$status' },
                        axes: { $first: '$axes' },
                        axes_missing: { $first: '$axes_missing' },
                        computed_at: { $first: '$computed_at' },
                        model_version: { $first: '$model_version' },
                        todos: { $first: '$todos' },
                    },
                },
            ]);
            for (const row of rows) {
                latestByProduct.set(String(row._id), {
                    score: row.score ?? null,
                    status: row.status ?? null,
                    axes: row.axes || {},
                    axes_missing: row.axes_missing || [],
                    computed_at: row.computed_at ?? null,
                    model_version: row.model_version,
                    todos: Array.isArray(row.todos) ? row.todos : [],
                });
            }
        }

        const tagIds = products.flatMap(p => p.tag_ids ?? []);
        const tagDocs = tagIds.length ? await Tag.find({ _id: { $in: tagIds } }).select('_id name status').lean() : [];
        const tagById = new Map(tagDocs.map(t => [String(t._id), { name: t.name, pending: t.status === 'pending' }]));
        const tagsOf = (p: (typeof products)[number]) =>
            p.tag_ids?.length
                ? p.tag_ids.map(id => tagById.get(String(id))).filter((t): t is { name: string; pending: boolean } => Boolean(t))
                : (p.tags ?? []).filter(Boolean).map(name => ({ name, pending: false }));

        const sales = await salesByProduct(productIds);
        let items: HealthListItem[] = products.map(p => {
            const latest = latestByProduct.get(String(p._id));
            const todos = latest?.todos ?? [];
            return {
                product_id: String(p._id),
                title: p.title,
                thumbnail: Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null,
                score: latest?.score ?? null,
                status: latest?.status ?? null,
                axes: latest?.axes ?? {},
                axes_missing: latest?.axes_missing ?? [],
                computed_at: latest?.computed_at ? new Date(latest.computed_at).toISOString() : null,
                todos: todos.filter(t => t.type === 'todo'),
                n_todos: todos.filter(t => t.type === 'todo').length,
                warnings: todos.filter(t => t.type === 'warning'),
                tags: tagsOf(p),
                sales: sales.get(String(p._id)) ?? { ...EMPTY_SALES },
            };
        });

        const shopModelVersion = [...latestByProduct.values()]
            .map(v => v.model_version)
            .find((v): v is string => Boolean(v)) || MODEL_VERSION_FALLBACK;

        if (statusFilter) {
            items = items.filter(item => item.status === statusFilter);
        }

        items.sort((a, b) => {
            if (a.score === null && b.score === null) return 0;
            if (a.score === null) return 1;
            if (b.score === null) return -1;
            return b.score - a.score;
        });

        const data: HealthListData = { items, total: items.length };

        return {
            httpStatus: 200,
            body: ok(data, buildMeta({
                scope: 'shop',
                scope_id: shopId,
                database: 'vietcraft',
                collection: COLLECTION,
                mode: 'live',
                model_version: shopModelVersion,
                sample_size: items.length,
            })),
        };
    }
}
