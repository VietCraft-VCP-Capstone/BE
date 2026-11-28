// Chạy một việc nền theo khóa, không chạy trùng, và nghỉ một lúc sau khi lỗi.
// Dùng để đưa việc gọi LLM ra khỏi luồng request: request trả bản dự phòng ngay, LLM soạn xong thì lần tải sau dùng.

export type BackgroundStatus = 'idle' | 'running' | 'cooldown';

export class BackgroundOnce {
    private running = new Map<string, Promise<void>>();
    private failedAt = new Map<string, number>();

    constructor(private readonly opts: { now?: () => number; failureCooldownMs: number; maxKeys?: number }) {}

    private now(): number {
        return this.opts.now ? this.opts.now() : Date.now();
    }

    status(key: string): BackgroundStatus {
        if (this.running.has(key)) return 'running';
        const at = this.failedAt.get(key);
        if (at !== undefined && this.now() - at < this.opts.failureCooldownMs) return 'cooldown';
        return 'idle';
    }

    start(key: string, job: () => Promise<void>): 'started' | BackgroundStatus {
        const st = this.status(key);
        if (st !== 'idle') return st;
        if (this.failedAt.size > (this.opts.maxKeys ?? 1000)) this.failedAt.clear();
        const p = (async () => {
            try {
                await job();
                this.failedAt.delete(key);
            } catch {
                this.failedAt.set(key, this.now());
            } finally {
                this.running.delete(key);
            }
        })();
        this.running.set(key, p);
        return 'started';
    }

    /** Chờ việc nền của khóa xong (dùng trong test). */
    async settled(key: string): Promise<void> {
        await this.running.get(key);
    }
}
