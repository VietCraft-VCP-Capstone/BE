import { Router } from 'express';

/**
 * /api/analytics — chỗ dành cho các route analytics KHÔNG thuộc riêng người bán
 * (ví dụ ghi sự kiện xem/thêm giỏ của người mua).
 *
 * Ba proxy cũ POST /forecasting, /health-score, /anomaly đã gỡ: /forecasting trỏ vào
 * endpoint LSTM chưa train mà service AI đã xoá (API-99), còn hai cái kia không có màn
 * hình nào gọi. 16 tính năng phân tích của người bán nằm ở /api/seller/analytics
 * (seller-analytics.router.ts), có xác thực vai trò và gắn đúng shop.
 */
const router = Router();

export const analyticsRouter = router;
export default analyticsRouter;
