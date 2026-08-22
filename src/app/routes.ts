import { Router } from 'express';
import { authRouter } from '../modules/auth';
import { productsRouter } from '../modules/product';
import { ordersRouter } from '../modules/order';
import { analyticsRouter } from '../modules/analytics';
import { adminRouter } from '../modules/admin';
import { designsRouter } from '../modules/design/presentation/design.router';

const router = Router();

router.use('/auth', authRouter);
router.use('/products', productsRouter);
router.use('/orders', ordersRouter);
router.use('/analytics', analyticsRouter);
router.use('/admin', adminRouter);
router.use('/designs', designsRouter);

export default router;
