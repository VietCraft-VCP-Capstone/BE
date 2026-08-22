import { Router } from 'express';
import { authRouter } from '../modules/auth';
import { productsRouter } from '../modules/product';
import { ordersRouter } from '../modules/order';
import { analyticsRouter } from '../modules/analytics';
import { userRouter } from '../modules/user';
import { promotionRouter } from '../modules/promotion';

const router = Router();

router.use('/auth', authRouter);
router.use('/products', productsRouter);
router.use('/orders', ordersRouter);
router.use('/analytics', analyticsRouter);
router.use('/users', userRouter);
router.use('/promotions', promotionRouter);

export default router;
