import mongoose from 'mongoose';
import { ProductEvent } from '../infrastructure/models/product-event.model';
import { Product } from '../../product/infrastructure/models/product.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { logger } from '../../../shared/utils/logger';

const BOT_PATTERNS = [
    /bot/i,
    /crawler/i,
    /spider/i,
    /scraper/i,
    /curl/i,
    /wget/i,
    /googlebot/i,
    /bingbot/i,
    /slurp/i,
    /duckduckbot/i,
    /baiduspider/i,
];

const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

const isBot = (userAgent: string): boolean => {
    if (!userAgent) return false;
    return BOT_PATTERNS.some(pattern => pattern.test(userAgent));
};

export class EventService {

    static async recordEvent(
        productId: string,
        sessionId: string,
        eventType: 'view' | 'add_to_cart',
        userAgent: string,
        ipAddress: string,
        userId?: string
    ): Promise<boolean> {
        try {
            if (!mongoose.Types.ObjectId.isValid(productId)) {
                logger.warn(`Invalid product ID: ${productId}`);
                return false;
            }

            if (isBot(userAgent)) {
                logger.debug(`Bot detected: ${userAgent}`);
                return false;
            }

            const product = await Product.findById(productId).select('shop_id').lean();
            if (!product) {
                logger.warn(`Product not found: ${productId}`);
                return false;
            }

            if (userId) {
                const userObjectId = new mongoose.Types.ObjectId(userId);
                const shop = await Shop.findOne({ _id: product.shop_id, owner_id: userObjectId }).lean();
                if (shop) {
                    logger.debug(`Owner view filtered: product=${productId}, user=${userId}`);
                    return false;
                }

            }

            if (eventType === 'view' && ipAddress) {
                const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
                const recentEventsCount = await ProductEvent.countDocuments({
                    ip_address: ipAddress,
                    event_type: 'view',
                    created_at: { $gt: oneMinuteAgo }
                });
                if (recentEventsCount >= 10) {
                    logger.debug(`Rate limit exceeded: IP=${ipAddress}`);
                    return false;
                }
            }

            const now = new Date();
            const dedupeKey = `${sessionId}:${productId}:${eventType}:${Math.floor(now.getTime() / DEDUPE_WINDOW_MS)}`;
            const result = await ProductEvent.updateOne(
                { dedupe_key: dedupeKey },
                {
                    $setOnInsert: {
                        dedupe_key: dedupeKey,
                        product_id: new mongoose.Types.ObjectId(productId),
                        session_id: sessionId,
                        event_type: eventType,
                        user_id: userId ? new mongoose.Types.ObjectId(userId) : undefined,
                        user_agent: userAgent,
                        ip_address: ipAddress,
                        created_at: now,
                    },
                },
                { upsert: true },
            );
            return result.upsertedCount === 1;
        } catch (error: any) {
            if (error?.code === 11000) return false;
            logger.error(`Error recording event: ${error}`);
            return false;
        }
    }
}
