import mongoose from 'mongoose';
import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';
import { Shop } from '../../product/infrastructure/models/shop.model';

export interface AnalyticsViewer {
    live_shop_id: string | null;
    shop_name: string | null;
    analysed_shop_id: string | null;
    demo: boolean;
}

export interface AiResponse {
    status: number;
    body: any;
}

const SHOP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export class AiGatewayService {
    static isValidId(value: unknown): value is string {
        return typeof value === 'string' && SHOP_ID_PATTERN.test(value);
    }

    static async resolveViewer(user: { id: string; email?: string }): Promise<AnalyticsViewer> {
        let shop: { _id: unknown; shop_name?: string } | null = null;
        if (mongoose.Types.ObjectId.isValid(user.id)) {
            shop = await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(user.id) })
                .select('_id shop_name')
                .lean();
        }
        const liveShopId = shop ? String(shop._id) : null;
        const mapped = config.aiShopMap[(user.email || '').toLowerCase()];
        const globalDemoShopId = (process.env.AI_DEMO_SHOP_ID ?? config.aiDemoShopId).trim();

        // Ưu tiên shop thật nếu seller đã mở gian hàng trên sàn.
        // Chỉ dùng demo nếu email cố tình được map hoặc seller chưa có shop thật.
        let targetShopId = liveShopId;
        let isDemo = false;

        if (mapped) {
            targetShopId = mapped;
            isDemo = true;
        } else if (!liveShopId && globalDemoShopId) {
            targetShopId = globalDemoShopId;
            isDemo = true;
        }

        return {
            live_shop_id: liveShopId,
            shop_name: shop?.shop_name ?? null,
            analysed_shop_id: targetShopId,
            demo: isDemo,
        };
    }

    static async call(options: {
        method: 'GET' | 'POST' | 'DELETE';
        path: string;
        shopId: string;
        query?: Record<string, string>;
        body?: Record<string, unknown>;
        timeoutMs?: number;
    }): Promise<AiResponse> {
        if (!config.aiGatewaySecret) {
            return { status: 503, body: { error: 'ai_gateway_not_configured' } };
        }

        const url = new URL(options.path, config.aiAnalyticsUrl);
        for (const [key, value] of Object.entries(options.query || {})) {
            url.searchParams.set(key, value);
        }

        const headers: Record<string, string> = {
            Accept: 'application/json',
            'X-Gateway-Secret': config.aiGatewaySecret,
            'X-Shop-Id': options.shopId,
            'X-Debug-Shop-Id': options.shopId,
        };
        // fetch ném lỗi nếu GET kèm body; router luôn có req.body = {} nên chỉ gửi body cho POST/DELETE.
        const guiBody = options.body !== undefined && options.method !== 'GET';
        if (guiBody) headers['Content-Type'] = 'application/json';

        const timeoutMs = process.env.AI_TIMEOUT_MS
            ? Number(process.env.AI_TIMEOUT_MS)
            : Math.max(config.aiTimeoutMs || 5000, 20000);

        try {
            const response = await fetch(url, {
                method: options.method,
                headers,
                body: guiBody ? JSON.stringify(options.body) : undefined,
                signal: AbortSignal.timeout(timeoutMs),
            });
            const text = await response.text();
            try {
                return { status: response.status, body: text ? JSON.parse(text) : null };
            } catch {
                logger.error(`AI ${options.method} ${options.path} trả về không phải JSON (HTTP ${response.status})`);
                return { status: 502, body: { error: 'ai_bad_response' } };
            }
        } catch (error: any) {
            const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
            logger.error(
                `AI ${options.method} ${options.path} lỗi: ${timedOut ? `quá ${timeoutMs}ms` : error?.message}`,
            );
            return timedOut
                ? { status: 504, body: { error: 'ai_timeout' } }
                : { status: 502, body: { error: 'ai_unavailable' } };
        }
    }

    /** Service AI có đang sống không. Dùng cho màn hình trạng thái, không chặn request khác. */
    static async ping(): Promise<boolean> {
        try {
            const response = await fetch(new URL('/health', config.aiAnalyticsUrl), {
                signal: AbortSignal.timeout(1500),
            });
            return response.ok;
        } catch {
            return false;
        }
    }
}
