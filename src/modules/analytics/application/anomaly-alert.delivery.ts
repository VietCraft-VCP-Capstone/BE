import { Shop } from '../../product/infrastructure/models/shop.model';
import { User } from '../../user/infrastructure/models/user.model';
import { notificationService } from '../../notification';
import { sendPerformanceAlertEmail } from '../../../shared/utils/email.service';
import { AnalyticsAlertLog } from '../infrastructure/models/analytics-alert-log.model';
import { AnomalyEvent, buildAlertMessage } from './anomaly-alert.message';

const WEEKLY_CAP = 3;
const ALERT_LINK = '/seller/insights/alerts';
const DEFAULT_PREF = { email: false, app: true };
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type DeliveryResult = 'created' | 'duplicate' | 'capped' | 'no_shop';

export async function deliverAlert(e: AnomalyEvent): Promise<DeliveryResult> {
    const shop = await Shop.findById(e.shop_id).select('owner_id shop_name settings');
    if (!shop) return 'no_shop';

    let log;
    try {
        log = await AnalyticsAlertLog.create({ shop_id: shop._id, metric: e.metric, event_date: e.date });
    } catch (err: any) {
        if (err?.code === 11000) return 'duplicate';
        throw err;
    }

    const notifiedThisWeek = await AnalyticsAlertLog.countDocuments({
        shop_id: shop._id,
        $or: [{ notified: true }, { emailed: true }],
        created_at: { $gte: new Date(Date.now() - WEEK_MS) },
    });
    if (notifiedThisWeek >= WEEKLY_CAP) return 'capped';

    const pref = shop.settings?.notifications?.analytics?.performanceAlert ?? DEFAULT_PREF;
    const msg = buildAlertMessage(e);
    const notified = pref.app !== false;
    let emailed = false;

    if (notified) {
        await notificationService.createNotification({
            user_id: shop.owner_id,
            type: 'ANALYTICS_ALERT',
            ...msg,
            link: ALERT_LINK,
            metadata: {
                alert_id: e.id,
                metric: e.metric,
                date: e.date,
                z: e.z,
                direction: e.direction,
                expected: e.expected,
                actual: e.actual,
                top_listings: e.top_listings,
            },
        });
    }

    if (pref.email === true) {
        const user = await User.findById(shop.owner_id).select('email');
        if (user?.email) {
            await sendPerformanceAlertEmail(user.email, { shopName: shop.shop_name, ...msg, link: ALERT_LINK });
            emailed = true;
        }
    }

    await AnalyticsAlertLog.updateOne({ _id: log._id }, { notified, emailed });
    return 'created';
}
