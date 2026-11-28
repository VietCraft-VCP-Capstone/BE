import { SeasonalPlan } from '../infrastructure/models/seasonal-plan.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { notificationService } from '../../notification/application/notification.service';
import { logger } from '../../../shared/utils/logger';
import { isMongoReady } from '../../../app/config';

// Nhắc việc theo mốc cho các dịp seller đã lập kế hoạch (có bản ghi seasonal_plans kèm mốc thời gian).

export interface PlanMilestones {
    event_name?: string;
    traction_start?: string;
    cut_off_date?: string;
    event_date?: string;
    post_event_end?: string;
}

export type ReminderKey = 'traction_start' | 'cutoff_soon' | 'post_event';

export interface DueReminder { key: ReminderKey; title: string; content: string }

const CUTOFF_SOON_DAYS = 3;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Mốc cần nhắc hôm nay (`today` = YYYY-MM-DD giờ VN). Chỉ nhắc trong khoảng của mốc, không nhắc bù. */
export function dueReminders(m: PlanMilestones, reminded: Record<string, unknown>, today: string): DueReminder[] {
    const name = m.event_name || 'dịp này';
    const out: DueReminder[] = [];
    const { traction_start: trac, cut_off_date: cut, event_date: ev, post_event_end: pe } = m;
    if (trac && cut && !reminded.traction_start && today >= trac && today <= cut) {
        out.push({
            key: 'traction_start',
            title: `Đã tới ngày mở bán ${name}`,
            content: 'Đăng sản phẩm cho dịp, gắn thẻ từ khóa và bật ưu đãi để sàn kịp hiển thị trước cao điểm.',
        });
    }
    if (cut && !reminded.cutoff_soon && today <= cut && dayDiff(today, cut) <= CUTOFF_SOON_DAYS) {
        const left = dayDiff(today, cut);
        out.push({
            key: 'cutoff_soon',
            title: left > 0 ? `Còn ${left} ngày tới hạn chốt đơn ${name}` : `Hôm nay là hạn chốt đơn ${name}`,
            content: 'Sau hạn chốt chỉ nên nhận hàng có sẵn và giao nhanh. Kiểm tra tồn kho và đóng gói đơn đang chờ.',
        });
    }
    if (ev && pe && !reminded.post_event && today > ev && today <= pe) {
        out.push({
            key: 'post_event',
            title: `${name} đã qua: xem kết quả`,
            content: 'So số đơn thực tế với mức ngày thường và đánh giá dịp này để kế hoạch năm sau chính xác hơn.',
        });
    }
    return out;
}

export interface ReminderPlan { id: string; owner_id: string; event_key: string; milestones: PlanMilestones; reminded: Record<string, unknown> }

export interface SeasonalReminderDeps {
    today(): string;
    listPlans(today: string): Promise<ReminderPlan[]>;
    claim(planId: string, key: ReminderKey): Promise<boolean>;
    release(planId: string, key: ReminderKey): Promise<void>;
    notify(ownerId: string, reminder: DueReminder, plan: ReminderPlan): Promise<void>;
}

/** Gửi các nhắc việc đến hạn; claim nguyên tử để nhiều instance không gửi trùng. Trả về số nhắc đã gửi. */
export async function processSeasonalReminders(deps: SeasonalReminderDeps): Promise<number> {
    const today = deps.today();
    let sent = 0;
    for (const plan of await deps.listPlans(today)) {
        for (const r of dueReminders(plan.milestones, plan.reminded || {}, today)) {
            if (!await deps.claim(plan.id, r.key)) continue;
            try {
                await deps.notify(plan.owner_id, r, plan);
                sent += 1;
            } catch (error) {
                await deps.release(plan.id, r.key);
                throw error;
            }
        }
    }
    return sent;
}

const vnToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

export function defaultDeps(): SeasonalReminderDeps {
    return {
        today: vnToday,
        async listPlans(today) {
            const plans = await SeasonalPlan.find({
                'milestones.post_event_end': { $gte: today },
                'milestones.traction_start': { $lte: today },
            }).select('_id shop_id event_key milestones reminded').limit(500).lean();
            const shops = await Shop.find({ _id: { $in: plans.map((p: any) => p.shop_id) } }).select('_id owner_id').lean();
            const owners = new Map(shops.map((s: any) => [String(s._id), s.owner_id ? String(s.owner_id) : '']));
            return plans
                .map((p: any) => ({ id: String(p._id), owner_id: owners.get(String(p.shop_id)) || '', event_key: p.event_key, milestones: p.milestones || {}, reminded: p.reminded || {} }))
                .filter(p => p.owner_id);
        },
        async claim(planId, key) {
            const res = await SeasonalPlan.updateOne(
                { _id: planId, [`reminded.${key}`]: { $exists: false } },
                { $set: { [`reminded.${key}`]: new Date().toISOString() } },
            );
            return res.modifiedCount === 1;
        },
        async release(planId, key) {
            await SeasonalPlan.updateOne({ _id: planId }, { $unset: { [`reminded.${key}`]: '' } });
        },
        async notify(ownerId, r, plan) {
            await notificationService.createNotification({
                user_id: ownerId,
                type: 'ANALYTICS_ALERT',
                title: r.title,
                content: r.content,
                link: `/seller/insights/seasonal?campaign=${encodeURIComponent(plan.event_key)}`,
                metadata: { seasonal_plan_id: plan.id, reminder: r.key },
            });
        },
    };
}

export class SeasonalReminderJob {
    private static timer: NodeJS.Timeout | undefined;
    private static running = false;

    static start(intervalMs = 60 * 60_000): void {
        if (this.timer) return;
        const run = async () => {
            if (!isMongoReady() || this.running) return;
            this.running = true;
            try { await processSeasonalReminders(defaultDeps()); }
            catch (error: any) { logger.error(`[SEASONAL REMINDER] ${error.message}`); }
            finally { this.running = false; }
        };
        this.timer = setInterval(() => { void run(); }, intervalMs);
        this.timer.unref();
        void run();
    }

    static stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }
}
