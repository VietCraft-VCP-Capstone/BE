import mongoose from 'mongoose';
import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';
import { Shop } from '../../product/infrastructure/models/shop.model';

/**
 * Cổng gọi service AI (FastAPI, repo vc-ai/AI-Analysic) thay cho người bán.
 *
 * FE không bao giờ gọi thẳng service AI. BE đã xác thực JWT + vai trò seller, tự tra
 * shop của người đó, rồi gửi sang AI kèm hai header:
 *   X-Gateway-Secret  bí mật dùng chung, trùng AI_GATEWAY_SECRET bên AI
 *   X-Shop-Id         shop mà BE đã xác thực, AI không nhận shop từ query
 */

/** Ai đang xem và đang xem số liệu của shop nào. FE dùng để hiện nhãn "shop mẫu". */
export interface AnalyticsViewer {
    live_shop_id: string | null;
    shop_name: string | null;
    /** Shop mà service AI thực sự phân tích. Khác live_shop_id khi đang ở chế độ demo. */
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

    /**
     * Người bán này xem số liệu của shop nào.
     *
     * Thứ tự ưu tiên:
     *   1. AI_SHOP_MAP  ánh xạ riêng cho email này sang một shop mẫu
     *   2. AI_DEMO_SHOP_ID  chế độ shop mẫu cho TẤT CẢ người bán
     *   3. shop thật của người bán  (mặc định)
     * Riêng trước chung, để một account demo không buộc cả nhóm phải xem dữ liệu mồi.
     */
    static async resolveViewer(user: { id: string; email?: string }): Promise<AnalyticsViewer> {
        let shop: { _id: unknown; shop_name?: string } | null = null;
        if (mongoose.Types.ObjectId.isValid(user.id)) {
            shop = await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(user.id) })
                .select('_id shop_name')
                .lean();
        }
        const liveShopId = shop ? String(shop._id) : null;
        const mapped = config.aiShopMap[(user.email || '').toLowerCase()];
        const demoShopId = mapped || config.aiDemoShopId.trim();

        return {
            live_shop_id: liveShopId,
            shop_name: shop?.shop_name ?? null,
            analysed_shop_id: demoShopId || liveShopId,
            demo: Boolean(demoShopId),
        };
    }

    /**
     * Gọi một endpoint của service AI. Không ném lỗi: mọi kết cục đều thành {status, body}
     * để router chuyển nguyên mã lỗi hợp đồng (400/403/404/503) về FE.
     */
    static async call(options: {
        method: 'GET' | 'POST' | 'DELETE';
        path: string;
        shopId: string;
        query?: Record<string, string>;
        body?: Record<string, unknown>;
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
        };
        if (options.body) headers['Content-Type'] = 'application/json';

        try {
            const response = await fetch(url, {
                method: options.method,
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
                signal: AbortSignal.timeout(config.aiTimeoutMs),
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
                `AI ${options.method} ${options.path} lỗi: ${timedOut ? `quá ${config.aiTimeoutMs}ms` : error?.message}`,
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
