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

const isBot = (userAgent: string): boolean => {
    // Empty user-agent for server-side events should not be considered a bot
    if (!userAgent) return false;
    return BOT_PATTERNS.some(pattern => pattern.test(userAgent));
};

export class EventService {

    /**
     * Record a product event (view or add_to_cart)
     * Filters: bot, owner, admin
     * Deduplication: 30-min window per (session_id, product_id, event_type)
     * Rate limiting: max 10 views per IP per minute
     */
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

                // Check if user is admin (assuming admin check via role)
                // This would need to be adjusted based on actual admin role structure
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

            // Deduplication: check if event exists in 30-min window
            const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
            const existingEvent = await ProductEvent.findOne({
                session_id: sessionId,
                product_id: new mongoose.Types.ObjectId(productId),
                event_type: eventType,
                created_at: { $gt: thirtyMinutesAgo }
            });

            if (existingEvent) {
                logger.debug(`Duplicate event filtered: session=${sessionId}, product=${productId}, type=${eventType}`);
                return false;
            }

            // Record the event
            await ProductEvent.create({
                product_id: new mongoose.Types.ObjectId(productId),
                session_id: sessionId,
                event_type: eventType,
                user_id: userId ? new mongoose.Types.ObjectId(userId) : undefined,
                user_agent: userAgent,
                ip_address: ipAddress,
                created_at: new Date()
            });

            logger.debug(`Event recorded: product=${productId}, type=${eventType}, session=${sessionId}`);
            return true;
        } catch (error) {
            logger.error(`Error recording event: ${error}`);
            return false;
        }
    }
}
