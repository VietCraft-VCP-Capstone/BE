import mongoose from 'mongoose';
import { ProductEvent } from '../infrastructure/models/product-event.model';
import { Product } from '../../product/infrastructure/models/product.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { logger } from '../../../shared/utils/logger';

// Bot user-agents patterns
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
    // Empty user-agent for server-side events should not be considered a bot
    if (!userAgent) return false;
    return BOT_PATTERNS.some(pattern => pattern.test(userAgent));
};

export class EventService {

    /** Ghi view/add_to_cart: lọc bot và chủ shop, chống trùng 30 phút, tối đa 10 view/IP/phút. */
    static async recordEvent(
        productId: string,
        sessionId: string,
        eventType: 'view' | 'add_to_cart',
        userAgent: string,
        ipAddress: string,
        userId?: string
    ): Promise<boolean> {
        try {
            // Validate input
            if (!mongoose.Types.ObjectId.isValid(productId)) {
                logger.warn(`Invalid product ID: ${productId}`);
                return false;
            }

            // Filter bots
            if (isBot(userAgent)) {
                logger.debug(`Bot detected: ${userAgent}`);
                return false;
            }

            // Get product info
            const product = await Product.findById(productId).select('shop_id').lean();
            if (!product) {
                logger.warn(`Product not found: ${productId}`);
                return false;
            }

            // Filter owner and admin
            if (userId) {
                const userObjectId = new mongoose.Types.ObjectId(userId);
                const shop = await Shop.findOne({ _id: product.shop_id, owner_id: userObjectId }).lean();
                if (shop) {
                    logger.debug(`Owner view filtered: product=${productId}, user=${userId}`);
                    return false;
                }

                // Chưa lọc admin.
            }

            // Rate limiting: max 10 views per IP per minute (only for client-side events)
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
            // Hai request cùng khoá tới cùng lúc: bản thứ hai chạm unique index, coi là trùng.
            if (error?.code === 11000) return false;
            logger.error(`Error recording event: ${error}`);
            return false;
        }
    }
}
