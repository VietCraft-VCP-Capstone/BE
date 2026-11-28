import mongoose from 'mongoose';
import type { AnalyticsViewer } from './ai-gateway.service';

/**
 * Shop được phép ghi kế hoạch mùa vụ (lưu ý tưởng, mốc, đánh giá, bản nháp).
 * Shop demo dùng chung cho nhiều người nên chỉ cho đọc; trả null khi không được ghi.
 */
export function writableShopId(viewer: AnalyticsViewer): string | null {
    if (viewer.demo) return null;
    const id = viewer.live_shop_id;
    return id && mongoose.Types.ObjectId.isValid(id) ? id : null;
}
