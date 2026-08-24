import { Router } from 'express';
import { authRouter } from '../modules/auth';
import { productsRouter, wishlistRouter } from '../modules/product';
import { ordersRouter, cartRouter } from '../modules/order';
import { analyticsRouter } from '../modules/analytics';
import { userRouter } from '../modules/user';
import { promotionRouter } from '../modules/promotion';
import { sellerSettingsRouter } from '../modules/seller';

const router = Router();

router.use('/auth', authRouter);
router.use('/products', productsRouter);
router.use('/favorites', wishlistRouter);
router.use('/orders', ordersRouter);
router.use('/cart', cartRouter);
router.use('/analytics', analyticsRouter);
router.use('/users', userRouter);
router.use('/promotions', promotionRouter);
router.use('/seller/settings', sellerSettingsRouter);

export default router;

