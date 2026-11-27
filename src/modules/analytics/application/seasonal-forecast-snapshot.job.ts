import mongoose from 'mongoose';
import { SeasonalPlan } from '../infrastructure/models/seasonal-plan.model';
import { SeasonalForecastLog } from '../infrastructure/models/seasonal-forecast-log.model';
import { Order } from '../../order/infrastructure/models/order.model';
import { logger } from '../../../shared/utils/logger';
import { isMongoReady } from '../../../app/config';
import { buildForecastSnapshot, ForecastSnapshot } from './seasonal-forecast-log';
import { isValidDemandOrder } from './seasonal-math';

// Ghi nhật ký dự báo mỗi tuần cho các kỳ seller đã lập kế hoạch, không phụ thuộc việc seller mở trang,
// để sau lễ luôn có đủ bản dự báo đối chiếu với thực tế.

export interface SnapshotPlan { shop_id: string; event_key: string; event_year: number; milestones: { traction_start?: string; event_date?: string } }
export interface SnapshotKey { shop_id: string; event_key: string; event_year: number }

export interface ForecastSnapshotDeps {
    now(): Date;
    listPlans(todayVn: string): Promise<SnapshotPlan[]>;
    loadOrders(shopId: string): Promise<any[]>;
    save(key: SnapshotKey, snap: ForecastSnapshot): Promise<void>;
}

export async function processForecastSnapshots(deps: ForecastSnapshotDeps): Promise<number> {
    const now = deps.now();
    const todayVn = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    const ordersByShop = new Map<string, any[]>();
    let saved = 0;
    for (const plan of await deps.listPlans(todayVn)) {
        if (!ordersByShop.has(plan.shop_id)) ordersByShop.set(plan.shop_id, await deps.loadOrders(plan.shop_id));
        const snap = buildForecastSnapshot(ordersByShop.get(plan.shop_id)!, plan.milestones || {}, now);
        if (!snap) continue;
        await deps.save({ shop_id: plan.shop_id, event_key: plan.event_key, event_year: plan.event_year }, snap);
        saved += 1;
    }
    return saved;
}

const ORDER_LOOKBACK_DAYS = 400;

function defaultDeps(): ForecastSnapshotDeps {
    return {
        now: () => new Date(),
        async listPlans(todayVn) {
            const plans = await SeasonalPlan.find({ 'milestones.event_date': { $gte: todayVn } })
                .select('shop_id event_key event_year milestones').limit(2000).lean();
            return plans.map((p: any) => ({ shop_id: String(p.shop_id), event_key: p.event_key, event_year: p.event_year, milestones: p.milestones || {} }));
        },
        async loadOrders(shopId) {
            const docs = await Order.find({
                shop_id: new mongoose.Types.ObjectId(shopId),
                created_at: { $gte: new Date(Date.now() - ORDER_LOOKBACK_DAYS * 86400000) },
                order_status: { $ne: 'CANCELLED' },
                is_simulated: { $ne: true },
            }).select('created_at order_status payment_method payment_status refund_status is_simulated').limit(3000).lean();
            return (docs as any[]).filter(isValidDemandOrder);
        },
        async save(key, snap) {
            // $setOnInsert: mỗi tuần giữ bản đầu tiên, không ghi đè
            await SeasonalForecastLog.updateOne(
                { shop_id: new mongoose.Types.ObjectId(key.shop_id), event_key: key.event_key, event_year: key.event_year, iso_week: snap.iso_week },
                { $setOnInsert: { ...snap, search_uplift: null } },
                { upsert: true },
            );
        },
    };
}

export class SeasonalForecastSnapshotJob {
    private static timer: NodeJS.Timeout | undefined;
    private static running = false;

    static start(intervalMs = 6 * 60 * 60_000): void {
        if (this.timer) return;
        const run = async () => {
            if (!isMongoReady() || this.running) return;
            this.running = true;
            try { await processForecastSnapshots(defaultDeps()); }
            catch (error: any) { logger.error(`[SEASONAL FORECAST LOG] ${error.message}`); }
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
