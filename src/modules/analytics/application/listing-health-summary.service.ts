import mongoose from 'mongoose';
import { Product } from '../../product/infrastructure/models/product.model';
import { ListingHealthScore } from '../../product/infrastructure/models/listing-health-score.model';
import { buildMeta, ok, insufficient, Envelope } from './envelope';

// F29 · Điểm cả shop theo ngày, cho biểu đồ đầu trang "Sức khoẻ sản phẩm".

export interface HealthSummaryPoint {
    date: string;
    avg_score: number;
    good: number;
    needs_improvement: number;
    poor: number;
    /** Số sản phẩm có điểm trong ngày đó. */
    n: number;
}

export async function healthSummary(shopId: string, days: number): Promise<{ httpStatus: number; body: Envelope<HealthSummaryPoint[]> | Envelope<null> }> {
    const meta = (extra: { computed_at?: Date | null; model_version?: string; sample_size?: number } = {}) => buildMeta({
        scope: 'shop',
        scope_id: mongoose.Types.ObjectId.isValid(shopId) ? shopId : null,
        database: 'vietcraft',
        collection: 'listing_health_scores',
        mode: 'live',
        model_version: extra.model_version || 'health-1.0',
        computed_at: extra.computed_at ?? null,
        sample_size: extra.sample_size ?? 0,
    });

    if (!mongoose.Types.ObjectId.isValid(shopId)) {
        return { httpStatus: 200, body: insufficient('Cần thiết lập gian hàng thật trước khi xem điểm sức khoẻ listing.', meta()) };
    }

    const products = await Product.find({ shop_id: shopId, seed_ref: { $exists: false } }).select('_id').lean();
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));

    const rows = products.length === 0 ? [] : await ListingHealthScore.aggregate([
        { $match: { product_id: { $in: products.map(p => p._id) }, date: { $gte: since }, score: { $ne: null } } },
        {
            $group: {
                _id: '$date',
                avg_score: { $avg: '$score' },
                good: { $sum: { $cond: [{ $eq: ['$status', 'good'] }, 1, 0] } },
                needs_improvement: { $sum: { $cond: [{ $eq: ['$status', 'needs_improvement'] }, 1, 0] } },
                poor: { $sum: { $cond: [{ $eq: ['$status', 'poor'] }, 1, 0] } },
                n: { $sum: 1 },
                computed_at: { $max: '$computed_at' },
                model_version: { $first: '$model_version' },
            },
        },
        { $sort: { _id: 1 } },
    ]);

    if (rows.length === 0) {
        return { httpStatus: 200, body: insufficient(`Chưa có điểm nào trong ${days} ngày qua.`, meta()) };
    }

    const points: HealthSummaryPoint[] = rows.map(r => ({
        date: new Date(r._id).toISOString().slice(0, 10),
        avg_score: Math.round(r.avg_score * 10) / 10,
        good: r.good,
        needs_improvement: r.needs_improvement,
        poor: r.poor,
        n: r.n,
    }));
    const latest = rows[rows.length - 1];
    return {
        httpStatus: 200,
        body: ok(points, meta({ computed_at: latest.computed_at, model_version: latest.model_version, sample_size: points.length })),
    };
}
