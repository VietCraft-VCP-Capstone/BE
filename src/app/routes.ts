import { Router } from 'express';
import { authRouter } from '../modules/auth';

import { adminRouter, adminPromotionsRouter, adminFinanceRouter } from '../modules/admin';
import { categoryRouter } from '../modules/category';
import { tagsRouter } from '../modules/tags';
import { userRouter } from '../modules/user';
import { sellerSettingsRouter, sellerOrdersRouter, sellerKycRouter, sellerPromotionsRouter, sellerPrinterRouter } from '../modules/seller';

import { cartRouter } from '../modules/cart';
import { productsRouter, wishlistRouter, shopRouter } from '../modules/product';
import { ordersRouter, reviewRouter } from '../modules/order';

import { paymentRouter } from '../modules/payment';
import { promotionRouter } from '../modules/promotion';

import { analyticsRouter, sellerAnalyticsRouter } from '../modules/analytics';
import { designsRouter } from '../modules/design/presentation/design.router';
import { chatRouter } from '../modules/chat';
import { notificationRouter } from '../modules/notification';
import { uploadRouter } from '../modules/upload';

const router = Router();

router.use('/auth', authRouter);
router.use('/admin/categories', categoryRouter);
router.use('/admin/tags', tagsRouter);
router.use('/admin/promotions', adminPromotionsRouter);
router.use('/admin/finance', adminFinanceRouter);
router.use('/admin', adminRouter);
router.use('/users', userRouter);
router.use('/seller/kyc', sellerKycRouter);
router.use('/seller/settings', sellerSettingsRouter);
router.use('/seller/promotions', sellerPromotionsRouter);
router.use('/seller/orders', sellerOrdersRouter);
router.use('/seller/analytics', sellerAnalyticsRouter);
router.use('/seller/printer', sellerPrinterRouter);


router.use('/cart', cartRouter);
router.use('/products', productsRouter);
router.use('/shops', shopRouter);
router.use('/orders', ordersRouter);
router.use('/reviews', reviewRouter);
router.use('/payment', paymentRouter);

router.use('/favorites', wishlistRouter);
router.use('/analytics', analyticsRouter);
router.use('/promotions', promotionRouter);

router.use('/designs', designsRouter);
router.use('/upload', uploadRouter);
router.use('/chat', chatRouter);
router.use('/notifications', notificationRouter);

export default router;
