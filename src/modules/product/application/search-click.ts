import mongoose from 'mongoose';
import { SearchLog } from '../../analytics/infrastructure/models/search-log.model';

export interface SearchClickInput {
    logId: mongoose.Types.ObjectId;
    productId: mongoose.Types.ObjectId;
    position: number;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

export function parseSearchClick(body: any): SearchClickInput | null {
    const { logId, productId, position } = body || {};
    if (typeof logId !== 'string' || !OBJECT_ID.test(logId)) return null;
    if (typeof productId !== 'string' || !OBJECT_ID.test(productId)) return null;
    if (!Number.isInteger(position) || position < 0 || position > 999) return null;
    return {
        logId: new mongoose.Types.ObjectId(logId),
        productId: new mongoose.Types.ObjectId(productId),
        position,
    };
}

/** Mỗi sản phẩm chỉ ghi 1 lần cho mỗi lượt tìm kiếm, tránh click lặp làm sai thống kê. */
export async function recordSearchClick(c: SearchClickInput): Promise<void> {
    await SearchLog.updateOne(
        { _id: c.logId, 'clicks.product_id': { $ne: c.productId } },
        { $push: { clicks: { product_id: c.productId, position: c.position, clicked_at: new Date() } } }
    );
}
