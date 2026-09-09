import { Router } from 'express';
import { authRouter } from '../modules/auth';

import { adminRouter } from '../modules/admin';
import { categoryRouter } from '../modules/category';
import { tagsRouter } from '../modules/tags';
import { userRouter } from '../modules/user';
import { sellerSettingsRouter, sellerOrdersRouter } from '../modules/seller';

import { cartRouter } from '../modules/cart';
import { productsRouter, wishlistRouter } from '../modules/product';
import { ordersRouter } from '../modules/order';
import { promotionRouter } from '../modules/promotion';

import { analyticsRouter } from '../modules/analytics';
import { designsRouter } from '../modules/design/presentation/design.router';
import { chatRouter } from '../modules/chat';


const router = Router();

router.use('/auth', authRouter);
// Category/Tag đã tách thành module riêng. Mount TRƯỚC '/admin' để router cụ thể
// thắng router tổng. URL giữ nguyên /api/admin/categories, /api/admin/tags nên FE
// không phải sửa gì. Guard admin nằm sẵn trên từng route trong 2 module đó.
router.use('/admin/categories', categoryRouter);
router.use('/admin/tags', tagsRouter);
router.use('/admin', adminRouter);
router.use('/users', userRouter);
router.use('/seller/settings', sellerSettingsRouter);
// Đơn BÁN được của gian hàng. Tách khỏi '/orders' (đơn người dùng ĐI MUA) vì hai bên
// lọc theo hai khoá khác nhau: buyer_id với /orders, shop_id với route này.
router.use('/seller/orders', sellerOrdersRouter);

router.use('/cart', cartRouter);
router.use('/products', productsRouter);
router.use('/orders', ordersRouter);

router.use('/favorites', wishlistRouter);
router.use('/analytics', analyticsRouter);
router.use('/promotions', promotionRouter);

router.use('/designs', designsRouter);
router.use('/chat', chatRouter);

export default router;
