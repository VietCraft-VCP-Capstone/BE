import { ProductEvent } from '../infrastructure/models/product-event.model';
import { ProductDailyMetric } from '../infrastructure/models/product-daily-metric.model';
import { Order as OrderModel } from '../../order/infrastructure/models/order.model';
import { logger } from '../../../shared/utils/logger';
import mongoose from 'mongoose';

export class RollupJob {
    private static isRunning = false;

    static async run(): Promise<void> {
        if (this.isRunning) {
            logger.warn('Rollup job is already running, skipping');
            return;
        }

        this.isRunning = true;
        const startTime = Date.now();
        logger.info('Starting nightly rollup job');

        try {
            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);

            const yesterday = new Date(today);
            yesterday.setUTCDate(yesterday.getUTCDate() - 1);


            logger.info(`Rollup date: ${yesterday.toISOString()}`);

            const eventAggregation = await ProductEvent.aggregate([
                {
                    $match: {
                        created_at: { $gte: yesterday, $lt: today }
                    }
                },
                {
                    $group: {
                        _id: {
                            product_id: '$product_id',
                            event_type: '$event_type'
                        },
                        count: { $sum: 1 }
                    }
                }
            ]);

            logger.info(`Found ${eventAggregation.length} event records to process`);

            const orderAggregation = await OrderModel.aggregate([
                {
                    $match: {
                        created_at: { $gte: yesterday, $lt: today },
                        seed_ref: { $exists: false },
                        is_simulated: { $ne: true },
                        order_status: { $ne: 'CANCELLED' }
                    }
                },
                {
                    $unwind: '$items'
                },
                {
                    $group: {
                        _id: '$items.product_id',
                        order_count: { $sum: 1 }
                    }
                }
            ]);

            logger.info(`Found ${orderAggregation.length} order records to process`);

            const metricsMap = new Map<string, any>();

            for (const record of eventAggregation) {
                const productIdStr = record._id.product_id.toString();
                if (!metricsMap.has(productIdStr)) {
                    metricsMap.set(productIdStr, {
                        product_id: record._id.product_id,
                        date: yesterday,
                        views: 0,
                        add_to_carts: 0,
                        orders_count: 0,
                        created_at: new Date(),
                        updated_at: new Date()
                    });
                }

                const metrics = metricsMap.get(productIdStr);
                if (record._id.event_type === 'view') {
                    metrics.views = record.count;
                } else if (record._id.event_type === 'add_to_cart') {
                    metrics.add_to_carts = record.count;
                }
            }

            for (const record of orderAggregation) {
                const productIdStr = record._id.toString();
                if (!metricsMap.has(productIdStr)) {
                    metricsMap.set(productIdStr, {
                        product_id: new mongoose.Types.ObjectId(record._id),
                        date: yesterday,
                        views: 0,
                        add_to_carts: 0,
                        orders_count: 0,
                        created_at: new Date(),
                        updated_at: new Date()
                    });
                }

                const metrics = metricsMap.get(productIdStr);
                metrics.orders_count = record.order_count;
            }

            let upsertCount = 0;
            for (const metrics of metricsMap.values()) {
                await ProductDailyMetric.findOneAndUpdate(
                    { product_id: metrics.product_id, date: metrics.date },
                    {
                        $set: {
                            views: metrics.views,
                            add_to_carts: metrics.add_to_carts,
                            orders_count: metrics.orders_count,
                            updated_at: new Date()
                        },
                        $setOnInsert: {
                            favorited_count: 0,
                            revenue: 0.0,
                            anomaly_detected: false,
                            anomaly_z_score: 0.0,
                            created_at: metrics.created_at
                        }
                    },
                    { upsert: true, new: true }
                );
                upsertCount++;
            }

            const duration = Date.now() - startTime;
            logger.info(`Rollup job completed: ${upsertCount} products updated in ${duration}ms`);

        } catch (error) {
            logger.error(`Rollup job failed: ${error}`);
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    static schedule(): void {
        logger.info('Scheduling nightly rollup job at 00:00 UTC');

        const scheduleNextRun = () => {
            const now = new Date();
            const tomorrow = new Date(now);
            tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
            tomorrow.setUTCHours(0, 0, 0, 0);

            const timeUntilNextRun = tomorrow.getTime() - now.getTime();
            logger.info(`Next rollup scheduled in ${Math.round(timeUntilNextRun / 1000)}s`);

            setTimeout(async () => {
                try {
                    await this.run();
                } catch (error) {
                    logger.error(`Scheduled rollup job failed: ${error}`);
                }
                scheduleNextRun();
            }, timeUntilNextRun);
        };

        scheduleNextRun();
    }
}
