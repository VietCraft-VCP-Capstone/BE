import mongoose from 'mongoose';
import { ProductDailyMetric } from '../../../analytics/infrastructure/models/product-daily-metric.model';

const WINDOW_MS = 30 * 86400000;

/** Điểm phổ biến 30 ngày = views + 3×add_to_carts + 5×orders_count. */
async function popularityRows(match: Record<string, any>, limit?: number): Promise<{ _id: mongoose.Types.ObjectId; pop: number }[]> {
    const pipeline: any[] = [
        { $match: { date: { $gte: new Date(Date.now() - WINDOW_MS) }, ...match } },
        {
            $group: {
                _id: '$product_id',
                pop: { $sum: { $add: ['$views', { $multiply: [3, '$add_to_carts'] }, { $multiply: [5, '$orders_count'] }] } },
            },
        },
        { $sort: { pop: -1 } },
    ];
    if (limit) pipeline.push({ $limit: limit });
    return ProductDailyMetric.aggregate(pipeline);
}

// shortcut: Map gồm mọi sp có metric 30 ngày, đổi sang lọc $in khi catalog lớn
export async function popularity(n: number): Promise<{ topIds: mongoose.Types.ObjectId[]; pop: Map<string, number> }> {
    const rows = await popularityRows({});
    return {
        topIds: rows.slice(0, n).map(r => r._id),
        pop: new Map(rows.map(r => [String(r._id), r.pop])),
    };
}
