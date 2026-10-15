import mongoose from 'mongoose';
import { FulfillmentJob, IFulfillmentJob } from '../infrastructure/models/fulfillment-job.model';
import { Order as OrderModel } from '../infrastructure/models/order.model';
import { printingShopApiService, PrintingApiError } from '../infrastructure/services/printing-shop-api.service';
import { logger } from '../../../shared/utils/logger';

const BACKOFF_DELAYS = [
    60 * 1000,
    5 * 60 * 1000,
    15 * 60 * 1000,
];

export class FulfillmentQueueService {
    private static isRunning = false;
    private static timer: NodeJS.Timeout | null = null;

    static async enqueueOrder(
        orderId: string | mongoose.Types.ObjectId,
        notBefore: Date = new Date(),
    ): Promise<IFulfillmentJob> {
        const order = await OrderModel.findById(orderId);
        if (!order) {
            throw new Error(`Không tìm thấy đơn hàng ID: ${orderId}`);
        }
        if (order.is_simulated) throw new Error('Đơn mô phỏng không thể vào hàng đợi fulfillment.');

        order.fulfillment_status = 'QUEUED';
        await order.save();

        let job = await FulfillmentJob.findOne({
            order_id: order._id,
            status: { $in: ['PENDING', 'PROCESSING'] }
        });

        if (!job) {
            job = await FulfillmentJob.create({
                order_id: order._id,
                order_code: order.order_code,
                action: 'DISPATCH_ORDER',
                payload: { order_id: order._id.toString() },
                status: 'PENDING',
                attempts: 0,
                max_attempts: 4,
                next_run_at: notBefore,
                error_history: []
            });
        } else if (job.status === 'PENDING' && job.next_run_at.getTime() < notBefore.getTime()) {
            job.next_run_at = notBefore;
            await job.save();
        }

        if (job.next_run_at.getTime() <= Date.now()) {
            this.processJob(job).catch(err => {
                logger.error(`[FULFILLMENT QUEUE] Lỗi khi xử lý job ${job!._id}: ${err.message}`);
            });
        }

        return job;
    }

    static async processJob(job: IFulfillmentJob): Promise<boolean> {
        const order = await OrderModel.findById(job.order_id);
        if (!order) {
            job.status = 'FAILED';
            job.last_error = 'Đơn hàng không còn tồn tại trong database';
            await job.save();
            return false;
        }
        if (order.is_simulated) {
            job.status = 'FAILED';
            job.last_error = 'Đơn mô phỏng bị chặn khỏi fulfillment.';
            await job.save();
            return false;
        }

        if (
            order.payment_status === 'REFUNDED'
            || order.order_status === 'CANCELLED'
            || order.fulfillment_status === 'CANCELLED'
        ) {
            job.status = 'FAILED';
            job.last_error = 'ORDER_CANCELED_OR_REFUNDED';
            await job.save();
            return false;
        }

        job.status = 'PROCESSING';
        job.attempts += 1;
        await job.save();

        try {
            logger.info(`[FULFILLMENT QUEUE] Bắt đầu dispatch đơn ${order.order_code} (Lần thử ${job.attempts}/${job.max_attempts})`);
            const result = await printingShopApiService.createFulfillmentOrder(order);

            order.supplier_order_id = result.supplier_order_id;
            order.fulfillment_status = 'SUBMITTED';
            order.seller_approval_status = 'APPROVED';
            order.printer_info = {
                printer_id: result.printer_id,
                printer_name: result.printer_name,
                supplier_order_id: result.supplier_order_id,
                dispatched_at: new Date(),
                printer_status: 'RECEIVED'
            };
            if (['ORDERED', 'PENDING_DESIGN'].includes(order.order_status)) {
                order.order_status = 'PROCESSING';
            }
            order.status_history.push({
                status: order.order_status,
                changed_at: new Date(),
                note: `Đã gửi sang xưởng in thành công (Mã đơn xưởng: ${result.supplier_order_id})`
            });
            await order.save();

            // Cập nhật job thành công
            job.status = 'COMPLETED';
            await job.save();

            logger.info(`[FULFILLMENT QUEUE] Hoàn tất dispatch đơn ${order.order_code} thành công.`);
            return true;
        } catch (err: any) {
            const isRetryable = err instanceof PrintingApiError ? err.isRetryable : true;
            const errorMsg = err?.message || String(err);

            job.last_error = errorMsg;
            job.error_history.push({
                attempt: job.attempts,
                error: errorMsg,
                timestamp: new Date()
            });

            // Nếu là lỗi 4xx (Bad request, sai format) -> Dừng luôn, không retry
            if (!isRetryable) {
                logger.error(`[FULFILLMENT QUEUE] Đơn ${order.order_code} bị từ chối với lỗi không thể retry: ${errorMsg}`);
                job.status = 'FAILED';
                order.fulfillment_status = 'FAILED';
                order.status_history.push({
                    status: order.order_status,
                    changed_at: new Date(),
                    note: `Gửi xưởng in thất bại: ${errorMsg}`
                });
                await Promise.all([job.save(), order.save()]);
                return false;
            }

            // Nếu đã vượt quá số lần retry tối đa -> Đánh dấu FAILED
            if (job.attempts >= job.max_attempts) {
                logger.error(`[FULFILLMENT QUEUE] Đơn ${order.order_code} đã hết số lần retry (${job.max_attempts} lần). Đánh dấu FAILED.`);
                job.status = 'FAILED';
                order.fulfillment_status = 'FAILED';
                order.status_history.push({
                    status: order.order_status,
                    changed_at: new Date(),
                    note: `Gửi xưởng thất bại sau ${job.max_attempts} lần thử lại: ${errorMsg}`
                });
                await Promise.all([job.save(), order.save()]);
                return false;
            }

            // Tính thời gian Exponential Backoff cho lần retry tiếp theo
            // Index 0: 1 phút, Index 1: 5 phút, Index 2: 15 phút
            const delayIndex = Math.min(job.attempts - 1, BACKOFF_DELAYS.length - 1);
            const delayMs = BACKOFF_DELAYS[delayIndex];
            job.next_run_at = new Date(Date.now() + delayMs);
            job.status = 'PENDING';
            await job.save();

            const delayMinutes = Math.round(delayMs / 60000);
            logger.warn(`[FULFILLMENT QUEUE] Đơn ${order.order_code} thất bại (Lần ${job.attempts}). Sẽ tự động thử lại sau ${delayMinutes} phút (vào lúc ${job.next_run_at.toLocaleTimeString()}).`);
            return false;
        }
    }

    /**
     * Chạy định kỳ quét các jobs PENDING đến hạn
     */
    static startWorker(intervalMs = 20000) {
        if (this.isRunning) return;
        this.isRunning = true;

        logger.info(`[FULFILLMENT QUEUE WORKER] Khởi động hàng đợi nền (Chu kỳ kiểm tra: ${intervalMs / 1000}s)`);

        this.timer = setInterval(async () => {
            try {
                const now = new Date();
                const pendingJobs = await FulfillmentJob.find({
                    status: 'PENDING',
                    next_run_at: { $lte: now }
                }).limit(10);

                if (pendingJobs.length > 0) {
                    logger.info(`[FULFILLMENT QUEUE WORKER] Tìm thấy ${pendingJobs.length} jobs đến hạn retry.`);
                    for (const job of pendingJobs) {
                        await this.processJob(job);
                    }
                }
            } catch (err: any) {
                logger.error(`[FULFILLMENT QUEUE WORKER ERROR] ${err.message}`);
            }
        }, intervalMs);
    }

    /**
     * Dừng worker khi tắt server
     */
    static stopWorker() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.isRunning = false;
        logger.info('[FULFILLMENT QUEUE WORKER] Đã dừng hàng đợi nền.');
    }

    static async retryManually(jobId: string): Promise<boolean> {
        const job = await FulfillmentJob.findById(jobId);
        if (!job) throw new Error('Không tìm thấy job');

        job.status = 'PENDING';
        job.next_run_at = new Date();
        await job.save();

        return await this.processJob(job);
    }
}
