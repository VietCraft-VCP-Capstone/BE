import crypto from 'crypto';
import { redisClient, isRedisReady } from '../../app/config';
import { logger } from '../utils/logger';

export class CacheService {
    private static instance: CacheService;

    public static getInstance(): CacheService {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService();
        }
        return CacheService.instance;
    }

    /**
     * Kiểm tra trạng thái sẵn sàng của Redis.
     */
    public isReady(): boolean {
        return isRedisReady();
    }

    /**
     * Tạo chuỗi băm md5 ngắn gọn từ object query để làm cache key an toàn.
     */
    public hashKey(obj: any): string {
        if (!obj || (typeof obj === 'object' && Object.keys(obj).length === 0)) {
            return 'all';
        }
        const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
        return crypto.createHash('md5').update(str).digest('hex').substring(0, 16);
    }

    /**
     * Lấy dữ liệu từ cache theo key.
     */
    public async get<T>(key: string): Promise<T | null> {
        if (!this.isReady()) {
            return null;
        }

        try {
            const raw = await redisClient.get(key);
            if (!raw) return null;

            try {
                return JSON.parse(raw) as T;
            } catch {
                return raw as unknown as T;
            }
        } catch (error: any) {
            logger.warn(`[Cache GET Error] Key: ${key} - ${error.message}`);
            return null;
        }
    }

    /**
     * Lưu dữ liệu vào cache với thời gian sống (TTL) tính bằng giây.
     * Mặc định TTL: 300 giây (5 phút).
     */
    public async set(key: string, value: any, ttlSeconds = 300): Promise<void> {
        if (!this.isReady() || value === undefined || value === null) {
            return;
        }

        try {
            const serialized = typeof value === 'string' ? value : JSON.stringify(value);
            await redisClient.set(key, serialized, { EX: ttlSeconds });
        } catch (error: any) {
            logger.warn(`[Cache SET Error] Key: ${key} - ${error.message}`);
        }
    }

    /**
     * Xóa một key cụ thể khỏi cache.
     */
    public async del(key: string): Promise<void> {
        if (!this.isReady()) {
            return;
        }

        try {
            await redisClient.del(key);
        } catch (error: any) {
            logger.warn(`[Cache DEL Error] Key: ${key} - ${error.message}`);
        }
    }

    /**
     * Xóa các keys theo pattern (Ví dụ: 'vietcraft:products:*')
     * Sử dụng scanIterator để duyệt an toàn, không block main thread Redis.
     */
    public async delByPattern(pattern: string): Promise<number> {
        if (!this.isReady()) {
            return 0;
        }

        try {
            let totalDeleted = 0;
            const batchKeys: string[] = [];

            for await (const key of redisClient.scanIterator({ MATCH: pattern, COUNT: 100 })) {
                batchKeys.push(key);
                if (batchKeys.length >= 100) {
                    await redisClient.del(batchKeys);
                    totalDeleted += batchKeys.length;
                    batchKeys.length = 0;
                }
            }

            if (batchKeys.length > 0) {
                await redisClient.del(batchKeys);
                totalDeleted += batchKeys.length;
            }

            if (totalDeleted > 0) {
                logger.info(`[Cache Invalidation] Pattern: "${pattern}" -> Xóa thành công ${totalDeleted} keys`);
            }
            return totalDeleted;
        } catch (error: any) {
            logger.warn(`[Cache delByPattern Error] Pattern: ${pattern} - ${error.message}`);
            return 0;
        }
    }

    /**
     * Cache-Aside Read-Through:
     * 1. Kiểm tra cache trước.
     * 2. Nếu HIT -> trả về kết quả ngay (< 5ms).
     * 3. Nếu MISS hoặc Redis offline -> gọi `fetchFn()`, lưu vào cache và trả về kết quả.
     */
    public async getOrSet<T>(
        key: string,
        fetchFn: () => Promise<T>,
        ttlSeconds = 300
    ): Promise<T> {
        // 1. Thử lấy từ cache nếu Redis sẵn sàng
        if (this.isReady()) {
            const cached = await this.get<T>(key);
            if (cached !== null) {
                return cached;
            }
        }

        // 2. Cache miss hoặc Redis chưa bật: Truy vấn nguồn cơ sở dữ liệu gốc
        const data = await fetchFn();

        // 3. Ghi ngược lại vào cache trong nền (không làm chậm luồng response)
        if (data !== undefined && data !== null) {
            this.set(key, data, ttlSeconds).catch(() => {});
        }

        return data;
    }

    /**
     * Xóa toàn bộ cache (chỉ dùng trong bảo trì/test)
     */
    public async flushAll(): Promise<void> {
        if (!this.isReady()) return;
        try {
            await redisClient.flushAll();
            logger.info('[Cache] Flushed all keys');
        } catch (error: any) {
            logger.warn(`[Cache flushAll Error] ${error.message}`);
        }
    }
}

export const cacheService = CacheService.getInstance();
