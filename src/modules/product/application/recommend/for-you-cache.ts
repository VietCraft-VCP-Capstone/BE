import { cacheService } from '../../../../shared/services/cache.service';
import { logger } from '../../../../shared/utils/logger';

const BUDGET_MS = 1500;      // chờ tính tối đa trước khi trả danh sách dự phòng
const LAST_TTL = 86400;      // bản gần nhất của từng người
const POPULAR_TTL = 21600;
const pending = new Map<string, Promise<any[]>>();

const sleep = (ms: number) => new Promise<null>(resolve => setTimeout(() => resolve(null), ms));

/** Tính 1 lần cho mỗi key dù nhiều request cùng lúc; xong ghi cả key theo version lẫn key "last". */
function refresh(key: string, lastKey: string, ttl: number, compute: () => Promise<any[]>): Promise<any[]> {
    const running = pending.get(key);
    if (running) return running;
    const job = (async () => compute())()
        .then(async r => {
            await Promise.all([
                cacheService.set(key, r, ttl),
                lastKey !== key ? cacheService.set(lastKey, r, LAST_TTL) : Promise.resolve(),
            ]);
            return r;
        })
        .finally(() => pending.delete(key));
    pending.set(key, job);
    job.catch((e: any) => logger.warn(`[ForYou] refresh ${key} lỗi: ${e.message}`));
    return job;
}

export async function staleFirst<T>(
    key: string,
    lastKey: string,
    popularKey: string,
    ttl: number,
    compute: () => Promise<T[]>,
    popular: () => Promise<T[]>,
): Promise<T[]> {
    const hit = await cacheService.get<T[]>(key);
    if (hit !== null) return hit;

    const job = refresh(key, lastKey, ttl, compute);

    const last = await cacheService.get<T[]>(lastKey);
    if (last !== null) return last;

    const done = await Promise.race([job.catch(() => null), sleep(BUDGET_MS)]);
    if (done !== null) return done;

    const fb = await cacheService.get<T[]>(popularKey);
    if (fb !== null) return fb;

    void warmPopular(popularKey, popular);
    return await job;
}

export function warmPopular<T>(popularKey: string, popular: () => Promise<T[]>): Promise<void> {
    return refresh(popularKey, popularKey, POPULAR_TTL, popular)
        .then(() => undefined, (e: any) => logger.warn(`[ForYou] warm popular lỗi: ${e.message}`));
}
