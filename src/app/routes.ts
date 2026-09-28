import { Router } from 'express';
import { authRouter } from '../modules/auth';

import { adminRouter, adminPromotionsRouter } from '../modules/admin';
import { categoryRouter } from '../modules/category';
import { tagsRouter } from '../modules/tags';
import { userRouter } from '../modules/user';
import { sellerSettingsRouter, sellerOrdersRouter, sellerKycRouter, sellerPromotionsRouter } from '../modules/seller';

import { cartRouter } from '../modules/cart';
import { productsRouter, wishlistRouter } from '../modules/product';
import { ordersRouter, refundRequestRouter } from '../modules/order';
import { paymentRouter } from '../modules/payment';
import { promotionRouter } from '../modules/promotion';

import { analyticsRouter } from '../modules/analytics';
import { designsRouter } from '../modules/design/presentation/design.router';
import { chatRouter } from '../modules/chat';
import { notificationRouter } from '../modules/notification';
import { uploadRouter } from '../modules/upload';

const router = Router();

router.use('/auth', authRouter);
// Category/Tag/Promotion đã tách thành module riêng. Mount TRƯỚC '/admin' để router cụ thể
// thắng router tổng. URL giữ nguyên /api/admin/categories, /api/admin/tags, /api/admin/promotions.
router.use('/admin/categories', categoryRouter);
router.use('/admin/tags', tagsRouter);
router.use('/admin/promotions', adminPromotionsRouter);
router.use('/admin', adminRouter);
router.use('/users', userRouter);
router.use('/seller/kyc', sellerKycRouter);
router.use('/seller/settings', sellerSettingsRouter);
router.use('/seller/promotions', sellerPromotionsRouter);
// Đơn BÁN được của gian hàng. Tách khỏi '/orders' (đơn người dùng ĐI MUA) vì hai bên
// lọc theo hai khoá khác nhau: buyer_id với /orders, shop_id với route này.
router.use('/seller/orders', sellerOrdersRouter);


router.use('/cart', cartRouter);
router.use('/products', productsRouter);
router.use('/orders', ordersRouter);
router.use('/', refundRequestRouter);
router.use('/payment', paymentRouter);

router.use('/favorites', wishlistRouter);
router.use('/analytics', analyticsRouter);
router.use('/promotions', promotionRouter);

router.use('/designs', designsRouter);
router.use('/upload', uploadRouter);
router.use('/chat', chatRouter);
router.use('/notifications', notificationRouter);

export default router;
