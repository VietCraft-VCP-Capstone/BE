import { Router } from 'express';
import { authRouter } from '../modules/auth';
import { productsRouter } from '../modules/product';
import { ordersRouter } from '../modules/order';
import { analyticsRouter } from '../modules/analytics';

const router = Router();

router.use('/auth', authRouter);
router.use('/products', productsRouter);
router.use('/orders', ordersRouter);
router.use('/analytics', analyticsRouter);

export default router;
