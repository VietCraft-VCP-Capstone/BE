import mongoose from 'mongoose';
import { Order } from '../../order/infrastructure/models/order.model';
import { Review } from '../../order/infrastructure/models/review.model';
import { ProductVariant } from '../../product/infrastructure/models/product-variant.model';
import { Tag } from '../../tags/infrastructure/models/tag.model';
import { ProductEvent } from '../infrastructure/models/product-event.model';

// Số bán và đầu vào điểm của sản phẩm, chỉ đọc dữ liệu thật (cùng bộ lọc LOC_DON_THAT bên AI).

export const SALES_WINDOW_DAYS = 30;

export interface ListingSales {
    views_30d: number;
    orders_30d: number;
    units_30d: number;
    revenue_30d: number;
}

export interface HealthInputs {
    n_images: number;
    description_length: number;
    n_approved_tags: number;
    n_pending_tags: number;
    /** null khi không phải hàng có sẵn hoặc không có phân loại đang bán (trục tồn kho không tính). */
    in_stock_ratio_pct: number | null;
    n_variants: number;
    n_variants_in_stock: number;
    days_since_content_change: number | null;
    n_reviews: number;
    avg_rating: number | null;
}

export interface ListingProductInfo {
    thumbnail: string | null;
    product_type: string | null;
    price_min: number | null;
    price_max: number | null;
    stock_total: number;
}

const REAL_ORDER = { seed_ref: { $exists: false }, is_simulated: { $ne: true } };

export const EMPTY_SALES: ListingSales = { views_30d: 0, orders_30d: 0, units_30d: 0, revenue_30d: 0 };

const toNumber = (value: unknown): number => {
    const n = Number(value?.toString?.() ?? value);
    return Number.isFinite(n) ? n : 0;
};

/** Lượt xem, số đơn, số món và doanh thu 30 ngày cho nhiều sản phẩm: một aggregate mỗi collection. */
export async function salesByProduct(productIds: mongoose.Types.ObjectId[]): Promise<Map<string, ListingSales>> {
    const out = new Map<string, ListingSales>();
    if (productIds.length === 0) return out;
    const since = new Date(Date.now() - SALES_WINDOW_DAYS * 86_400_000);
    const slot = (id: unknown) => {
        const key = String(id);
        if (!out.has(key)) out.set(key, { ...EMPTY_SALES });
        return out.get(key)!;
    };

    const [orderRows, viewRows] = await Promise.all([
        Order.aggregate([
            { $match: { ...REAL_ORDER, 'items.product_id': { $in: productIds }, order_status: { $ne: 'CANCELLED' }, created_at: { $gte: since } } },
            { $unwind: '$items' },
            { $match: { 'items.product_id': { $in: productIds } } },
            {
                $group: {
                    _id: '$items.product_id',
                    orders: { $addToSet: '$_id' },
                    units: { $sum: '$items.quantity' },
                    revenue: { $sum: { $multiply: ['$items.quantity', { $toDouble: { $ifNull: ['$items.retail_price', 0] } }] } },
                },
            },
            { $project: { orders: { $size: '$orders' }, units: 1, revenue: 1 } },
        ]),
        ProductEvent.aggregate([
            { $match: { product_id: { $in: productIds }, event_type: 'view', created_at: { $gte: since } } },
            { $group: { _id: '$product_id', n: { $sum: 1 } } },
        ]),
    ]);

    for (const row of orderRows) {
        const s = slot(row._id);
        s.orders_30d = row.orders;
        s.units_30d = row.units;
        s.revenue_30d = Math.round(toNumber(row.revenue));
    }
    for (const row of viewRows) slot(row._id).views_30d = row.n;
    return out;
}

/** Giá trị thật đang dùng để chấm từng tiêu chí, để trang chi tiết nói rõ "hiện có bao nhiêu". */
export async function healthInputs(product: {
    _id: mongoose.Types.ObjectId;
    images?: string[];
    description?: string;
    tags?: string[];
    tag_ids?: mongoose.Types.ObjectId[];
    product_type?: string;
    updated_at?: Date;
}, contentChangedAt: Date | null | undefined): Promise<{ inputs: HealthInputs; info: ListingProductInfo }> {
    const [variants, pendingTags, reviews] = await Promise.all([
        ProductVariant.find({ product_id: product._id }).select('is_active stock_quantity retail_price').lean(),
        product.tag_ids?.length ? Tag.find({ _id: { $in: product.tag_ids }, status: 'pending' }).select('_id').lean() : [],
        Review.find({ product_id: product._id }).select('order_id rating').lean(),
    ]);

    // Chỉ đếm đánh giá trên đơn thật, như engine AI.
    const realOrderIds = reviews.length
        ? new Set((await Order.aggregate([
            { $match: { _id: { $in: reviews.map(r => r.order_id) }, ...REAL_ORDER } },
            { $project: { _id: 1 } },
        ])).map(o => String(o._id)))
        : new Set<string>();
    const realReviews = reviews.filter(r => realOrderIds.has(String(r.order_id)));

    const active = variants.filter(v => v.is_active !== false);
    const inStock = active.filter(v => (v.stock_quantity ?? 0) > 0).length;
    const prices = active.map(v => toNumber(v.retail_price)).filter(p => p > 0);
    const nPending = pendingTags.length;
    const nApproved = product.tag_ids?.length
        ? product.tag_ids.length - nPending
        : (product.tags ?? []).filter(t => typeof t === 'string' && t.trim()).length;
    const changedAt = contentChangedAt ?? product.updated_at ?? null;

    return {
        inputs: {
            n_images: product.images?.length ?? 0,
            description_length: (product.description ?? '').trim().length,
            n_approved_tags: nApproved,
            n_pending_tags: nPending,
            in_stock_ratio_pct: product.product_type === 'READY_TO_SHIP' && active.length
                ? Math.round((inStock / active.length) * 1000) / 10
                : null,
            n_variants: active.length,
            n_variants_in_stock: inStock,
            days_since_content_change: changedAt ? Math.floor((Date.now() - new Date(changedAt).getTime()) / 86_400_000) : null,
            n_reviews: realReviews.length,
            avg_rating: realReviews.length
                ? Math.round((realReviews.reduce((s, r) => s + (r.rating ?? 0), 0) / realReviews.length) * 10) / 10
                : null,
        },
        info: {
            thumbnail: product.images?.[0] ?? null,
            product_type: product.product_type ?? null,
            price_min: prices.length ? Math.min(...prices) : null,
            price_max: prices.length ? Math.max(...prices) : null,
            stock_total: active.reduce((s, v) => s + Math.max(0, v.stock_quantity ?? 0), 0),
        },
    };
}
