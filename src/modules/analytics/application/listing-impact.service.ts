import mongoose from 'mongoose';
import { Product } from '../../product/infrastructure/models/product.model';
import { ListingHealthScore } from '../../product/infrastructure/models/listing-health-score.model';
import { ProductEvent } from '../infrastructure/models/product-event.model';
import { HealthAction, HealthActionEvent, HEALTH_ACTIONS } from '../infrastructure/models/health-action-event.model';
import { buildMeta, ok, Envelope } from './envelope';
import { HEALTH_VERSION, ListingHealthService, VN_OFFSET_MS } from './listing-health.service';
import {
    addDays, daysBetween, DailySeries, DaySnapshot, detectRevisions, FULL_DAYS, impactNumbers, ImpactNumbers, impactStatus,
    ImpactStatus, isStableControl, mixedChanges, Revision, Snapshot,
} from './listing-impact';

const LOOKBACK_DAYS = 60;
const SNAPSHOT_DAYS = LOOKBACK_DAYS + FULL_DAYS + 1;
const MAX_CONTROLS = 100;
const MIN_CONTROLS = 3;
const VN_TZ = 'Asia/Ho_Chi_Minh';

export interface ListingImpact {
    product_id: string;
    status: 'no_revision' | ImpactStatus;
    reason: 'not_enough_peers' | null;
    window_days: number | null;
    elapsed_days: number | null;
    revision: Revision | null;
    revisions: Revision[];
    mixed_changes: boolean;
    n_controls: number;
    views_per_day: ImpactNumbers['views_per_day'];
    cart_rate: ImpactNumbers['cart_rate'] | null;
}

type Reply = { httpStatus: number; body: object };

const utcDay = (day: string) => new Date(`${day}T00:00:00Z`);
const vnDayStart = (day: string) => new Date(utcDay(day).getTime() - VN_OFFSET_MS);

async function snapshotSeries(ids: mongoose.Types.ObjectId[], since: string, until: string): Promise<Map<string, DaySnapshot[]>> {
    const rows = await ListingHealthScore.find({
        product_id: { $in: ids },
        date: { $gte: utcDay(since), $lte: utcDay(until) },
        content_snapshot: { $ne: null },
    }).select('product_id date content_snapshot').sort({ date: 1 }).lean();
    const out = new Map<string, DaySnapshot[]>();
    for (const r of rows) {
        const key = String(r.product_id);
        const list = out.get(key) ?? [];
        list.push({ date: new Date(r.date).toISOString().slice(0, 10), snapshot: r.content_snapshot as Snapshot });
        out.set(key, list);
    }
    return out;
}

async function dailyCounts(ids: mongoose.Types.ObjectId[], from: string, to: string): Promise<Map<string, DailySeries>> {
    const rows = await ProductEvent.aggregate([
        { $match: { product_id: { $in: ids }, event_type: { $in: ['view', 'add_to_cart'] }, created_at: { $gte: vnDayStart(from), $lt: vnDayStart(to) } } },
        { $group: { _id: { p: '$product_id', d: { $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: VN_TZ } }, t: '$event_type' }, n: { $sum: 1 } } },
    ]);
    const out = new Map<string, DailySeries>();
    for (const r of rows) {
        const key = String(r._id.p);
        const series = out.get(key) ?? {};
        const day = series[r._id.d] ?? { views: 0, carts: 0 };
        if (r._id.t === 'view') day.views = r.n;
        else day.carts = r.n;
        series[r._id.d] = day;
        out.set(key, series);
    }
    return out;
}

export async function listingImpact(productId: string, shopId: string): Promise<Reply> {
    if (!ListingHealthService.isValidObjectId(productId)) return { httpStatus: 400, body: { error: 'invalid_param', field: 'id' } };
    const owned = await ListingHealthService.ownedProduct(productId, shopId);
    if ('denied' in owned) return owned.denied;
    const { product } = owned;

    const meta = buildMeta({ scope: 'listing', scope_id: productId, database: 'vietcraft', collection: 'listing_health_scores', mode: 'live', attributed_to_live_shop: true, model_version: HEALTH_VERSION });
    const today = new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
    const since = addDays(today, -SNAPSHOT_DAYS);
    const own = (await snapshotSeries([product._id], since, today)).get(String(product._id)) ?? [];
    const revisions = detectRevisions(own).filter(r => r.date >= addDays(today, -LOOKBACK_DAYS));
    const latest = revisions[revisions.length - 1] ?? null;
    const base: ListingImpact = {
        product_id: productId, status: 'no_revision', reason: null, window_days: null, elapsed_days: null, revision: latest,
        revisions, mixed_changes: false, n_controls: 0, views_per_day: null, cart_rate: null,
    };
    if (!latest) return { httpStatus: 200, body: ok(base, meta) };

    const elapsed = daysBetween(latest.date, today);
    const { status, window } = impactStatus(elapsed);
    const data: ListingImpact = { ...base, status, elapsed_days: elapsed, window_days: window };
    if (!window) return { httpStatus: 200, body: ok(data, meta) };

    const from = addDays(latest.date, -window);
    const to = addDays(latest.date, window);
    const category = product.categories?.[0];
    const peers = category
        ? await Product.find({ categories: category, _id: { $ne: product._id }, seed_ref: { $exists: false }, is_hidden: { $ne: true } }).select('_id').limit(MAX_CONTROLS).lean()
        : [];
    const peerSeries = await snapshotSeries(peers.map(p => p._id), addDays(from, -1), addDays(to, -1));
    const stable = peers.map(p => p._id).filter(id => isStableControl(peerSeries.get(String(id)) ?? [], from, to));
    const controls = stable.length >= MIN_CONTROLS ? stable : [];
    const daily = await dailyCounts([product._id, ...controls], from, to);
    const numbers = impactNumbers(daily.get(String(product._id)) ?? {}, controls.map(id => daily.get(String(id)) ?? {}), latest.date, window);

    return {
        httpStatus: 200,
        body: ok({
            ...data,
            reason: controls.length ? null : 'not_enough_peers',
            mixed_changes: mixedChanges(revisions, from, to),
            n_controls: stable.length,
            views_per_day: numbers.views_per_day,
            cart_rate: numbers.cart_rate,
        }, meta),
    };
}

function parseAction(raw: unknown): { recommendation_id: string; action: HealthAction; kind?: string } | { invalid: string } {
    const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const recommendation_id = typeof b.recommendation_id === 'string' ? b.recommendation_id.trim() : '';
    if (!recommendation_id || recommendation_id.length > 80) return { invalid: 'recommendation_id' };
    if (!HEALTH_ACTIONS.includes(b.action as HealthAction)) return { invalid: 'action' };
    return {
        recommendation_id,
        action: b.action as HealthAction,
        kind: typeof b.kind === 'string' ? b.kind.slice(0, 20) : undefined,
    };
}

export async function recordHealthAction(productId: string, shopId: string, userId: string, raw: unknown): Promise<Reply> {
    if (!ListingHealthService.isValidObjectId(productId)) return { httpStatus: 400, body: { error: 'invalid_param', field: 'id' } };
    const input = parseAction(raw);
    if ('invalid' in input) return { httpStatus: 400, body: { error: 'invalid_param', field: input.invalid } };
    const owned = await ListingHealthService.ownedProduct(productId, shopId);
    if ('denied' in owned) return owned.denied;

    const doc = await HealthActionEvent.create({ product_id: owned.product._id, shop_id: shopId, user_id: userId, ...input });
    const meta = buildMeta({ scope: 'listing', scope_id: productId, database: 'vietcraft', collection: 'health_action_events', mode: 'live', attributed_to_live_shop: true });
    const payload: Envelope<{ id: string; recommendation_id: string; action: HealthAction; created_at: Date }> = ok({
        id: String(doc._id), recommendation_id: input.recommendation_id, action: input.action, created_at: doc.created_at,
    }, meta);
    return { httpStatus: 201, body: payload };
}
