import { ReturnRequest, RETURN_REQUEST_ACTIVE_STATUSES } from '../infrastructure/models/return-request.model';
import { User } from '../../user/infrastructure/models/user.model';
import { notificationService } from '../../notification/application/notification.service';
import { logger } from '../../../shared/utils/logger';
import { isMongoReady } from '../../../app/config';
import { createReturnRequestService } from './return-request.runtime';

export interface ReturnDeadlineJobDependencies {
    listExpired(now: Date): Promise<Array<{ id: string; deadline: Date }>>;
    claim(id: string, deadline: Date): Promise<boolean>;
    remind(id: string, deadline: Date): Promise<void>;
    release(id: string, deadline: Date): Promise<void>;
    now(): Date;
}

export async function processExpiredReturnDeadlines(deps: ReturnDeadlineJobDependencies): Promise<number> {
    const requests = await deps.listExpired(deps.now());
    let reminded = 0;
    for (const request of requests) {
        if (!await deps.claim(request.id, request.deadline)) continue;
        try {
            await deps.remind(request.id, request.deadline);
            reminded += 1;
        } catch (error) {
            await deps.release(request.id, request.deadline);
            throw error;
        }
    }
    return reminded;
}

function defaultDependencies(): ReturnDeadlineJobDependencies {
    const service = createReturnRequestService();
    return {
        now: () => new Date(),
        async listExpired(now) {
            const docs = await ReturnRequest.find({ status: { $in: [...RETURN_REQUEST_ACTIVE_STATUSES] }, deadline_at: { $lt: now }, $expr: { $ne: ['$deadline_reminded_for', '$deadline_at'] } }).select('_id deadline_at').limit(100).lean();
            return docs.map((doc: any) => ({ id: String(doc._id), deadline: doc.deadline_at }));
        },
        async claim(id, deadline) {
            const result = await ReturnRequest.updateOne({ _id: id, status: { $in: [...RETURN_REQUEST_ACTIVE_STATUSES] }, deadline_at: deadline, deadline_reminded_for: { $ne: deadline } }, { $set: { deadline_reminded_for: deadline } }, { timestamps: false });
            return result.modifiedCount === 1;
        },
        async release(id, deadline) {
            await ReturnRequest.updateOne({ _id: id, deadline_reminded_for: deadline }, { $set: { deadline_reminded_for: null } }, { timestamps: false });
        },
        async remind(id, deadline) {
            const outcome = await service.processDeadline(id);
            if (outcome.kind !== 'REMIND_ADMIN') return;
            const admins = await User.find({ role: 'ADMIN', is_locked: { $ne: true } }).select('_id').lean();
            await Promise.all(admins.map((admin: any) => notificationService.createNotification({
                user_id: String(admin._id), type: 'ORDER_UPDATE', title: 'Yêu cầu đổi/trả đã quá hạn xử lý',
                content: 'Cần quản trị viên kiểm tra hồ sơ. Hệ thống chưa tự động quyết định hoàn tiền hoặc đổi hàng.',
                link: `/admin/returns?requestId=${encodeURIComponent(id)}`, metadata: { returnRequestId: id, deadline: deadline.toISOString() },
            })));
        },
    };
}

/** A persisted claim prevents repeated reminders across ticks and concurrent server instances. */
export class ReturnDeadlineJob {
    private static timer: NodeJS.Timeout | undefined;
    private static running = false;

    static start(intervalMs = 60_000): void {
        if (this.timer) return;
        const run = async () => {
            if (!isMongoReady() || this.running) return;
            this.running = true;
            try { await processExpiredReturnDeadlines(defaultDependencies()); }
            catch (error: any) { logger.error(`[RETURN DEADLINE] ${error.message}`); }
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
