import { AiGatewayService } from './ai-gateway.service';
import { notificationService } from '../../notification/application/notification.service';
import { Notification } from '../../notification/infrastructure/models/notification.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { ShopFollower } from '../../product/infrastructure/models/shop-follower.model';
import { User } from '../../user/infrastructure/models/user.model';
import { config, isMongoReady } from '../../../app/config';
import { sendCompetitorAlertEmail } from '../../../shared/utils/email.service';
import { logger } from '../../../shared/utils/logger';

// F36 (SRS 3.9.5): mỗi ngày gửi hàng mới của shop đang theo dõi vào bảng notifications có sẵn.
// Cảnh báo đã gửi nằm lại trong notifications nên bỏ theo dõi chỉ dừng cảnh báo mới (BR-204).

const KIND = 'competitor_new_listing';
const LINK = '/seller/insights/competitors#theo-doi';
const MAX_PER_SHOP = 10;        // phần dư vẫn còn trong cửa sổ 7 ngày nên lượt sau gửi tiếp
const RUN_AT_UTC_HOUR = 1;      // 08:00 giờ VN

export interface CompetitorAlert {
    listing_id: string;
    shop_id: string;
    shop_name: string | null;
    title: string | null;
    matched_tags: string[];
    type_name?: string | null;
    category_name?: string | null;
    threat?: { level: 'high' | 'medium' | 'low' } | null;
}

export function alertContent(alert: CompetitorAlert, tagNames: Record<string, string>): string {
    const tags = alert.matched_tags.slice(0, 3).map(t => tagNames[t] ?? t);
    const why = tags.length ? `cùng từ khoá ${tags.join(', ')}` : `cùng loại hàng ${alert.type_name ?? alert.category_name ?? 'với bạn'}`;
    const high = alert.threat?.level === 'high' ? ' Mức đe doạ: cao.' : '';
    return `${alert.shop_name ?? 'Shop bạn theo dõi'} vừa đăng "${alert.title ?? 'sản phẩm mới'}", ${why}.${high}`;
}

export class CompetitorAlertJob {
    private static running = false;

    /** Một lượt quét cho mọi seller đang theo dõi shop khác; trả số cảnh báo mới đã gửi. */
    static async run(): Promise<number> {
        if (this.running || !isMongoReady()) return 0;
        this.running = true;
        let sent = 0;
        try {
            const watcherIds = await ShopFollower.distinct('buyer_ids');
            const shops = await Shop.find({ owner_id: { $in: watcherIds }, status: { $in: ['ACTIVE', null] } }).select('_id owner_id').lean();
            for (const shop of shops) {
                try {
                    sent += await this.alertShop(String(shop.owner_id), String(shop._id));
                } catch (error: any) {
                    logger.error(`[COMPETITOR ALERT] shop ${shop._id}: ${error.message}`);
                }
            }
        } finally {
            this.running = false;
        }
        return sent;
    }

    private static async alertShop(userId: string, shopId: string): Promise<number> {
        const res = await AiGatewayService.call({ method: 'GET', path: '/api/analytics/competitor-tracking', shopId });
        if (res.status !== 200) {
            logger.warn(`[COMPETITOR ALERT] AI trả ${res.status} cho shop ${shopId}`);
            return 0;
        }
        const alerts: CompetitorAlert[] = res.body?.data?.alerts ?? [];
        if (!alerts.length) return 0;

        const already = await Notification.find({
            user_id: userId, type: 'ANALYTICS_ALERT', 'metadata.kind': KIND,
            'metadata.listing_id': { $in: alerts.map(a => a.listing_id) },
        }).select('metadata.listing_id').lean();
        const seen = new Set(already.map((n: any) => n.metadata?.listing_id));
        // AI đã xếp đe doạ cao lên đầu nên cắt theo thứ tự đó.
        const fresh = alerts.filter(a => !seen.has(a.listing_id)).slice(0, MAX_PER_SHOP);

        const tagNames: Record<string, string> = res.body.data.tag_names ?? {};
        const items = [];
        for (const alert of fresh) {
            const item = { title: `Đối thủ ra hàng mới: ${alert.shop_name ?? 'shop bạn theo dõi'}`, content: alertContent(alert, tagNames) };
            await notificationService.createNotification({
                user_id: userId, type: 'ANALYTICS_ALERT', ...item, link: LINK,
                metadata: { kind: KIND, listing_id: alert.listing_id, shop_id: alert.shop_id, threat_level: alert.threat?.level ?? null },
            });
            items.push(item);
        }
        if (items.length) await this.email(userId, items);
        return items.length;
    }

    private static async email(userId: string, items: { title: string; content: string }[]) {
        const user = await User.findById(userId).select('email notification_settings').lean();
        if (!user?.email || user.notification_settings?.email === false) return;
        try {
            await sendCompetitorAlertEmail(user.email, items, `${config.frontendUrl}${LINK}`);
        } catch (error: any) {
            // Thông báo trong app đã lưu; email lỗi không được làm hỏng lượt quét.
            logger.error(`[COMPETITOR ALERT] gửi email lỗi: ${error.message}`);
        }
    }

    static schedule(): void {
        if (process.env.COMPETITOR_ALERT_JOB !== 'true') {
            logger.info('[COMPETITOR ALERT] đang tắt; bật bằng COMPETITOR_ALERT_JOB=true');
            return;
        }
        const tick = async () => {
            try {
                logger.info(`[COMPETITOR ALERT] đã gửi ${await this.run()} cảnh báo mới`);
            } catch (error: any) {
                logger.error(`[COMPETITOR ALERT] ${error.message}`);
            }
        };
        const scheduleNext = () => {
            const now = new Date();
            const next = new Date(now);
            next.setUTCHours(RUN_AT_UTC_HOUR, 0, 0, 0);
            if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
            setTimeout(async () => { await tick(); scheduleNext(); }, next.getTime() - now.getTime()).unref();
        };
        // Một lượt sau khi khởi động để AI kịp lên; trùng thì đã có chặn theo listing_id.
        setTimeout(() => { void tick(); }, 30_000).unref();
        scheduleNext();
    }
}
