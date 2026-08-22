import { Router } from 'express';
import { authRouter } from '../modules/auth';
import { productsRouter, wishlistRouter } from '../modules/product';
import { ordersRouter, cartRouter } from '../modules/order';
import { analyticsRouter } from '../modules/analytics';

const router = Router();

router.use('/auth', authRouter);
router.use('/products', productsRouter);
router.use('/favorites', wishlistRouter);
router.use('/orders', ordersRouter);
router.use('/cart', cartRouter);
router.use('/analytics', analyticsRouter);

export default router;

