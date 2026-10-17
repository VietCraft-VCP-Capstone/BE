import { logger } from '../../../shared/utils/logger';
import { isMongoReady } from '../../../app/config';
import { Order } from '../../order/infrastructure/models/order.model';
import { payosService } from './payos.service';
import { OrdersService } from '../../order/application/order.service';
import { notificationService } from '../../notification';

/** Thời gian tối đa giữ chỗ thanh toán trực tuyến: 30 phút */
const UNPAID_EXPIRE_MS = 30 * 60 * 1000;

/** Khoảng thời gian tra cứu lịch sử đối soát tối đa */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Job đối soát thanh toán và tự động hủy đơn quá hạn:
 * 1. Định kỳ đối soát trạng thái đơn PayOS còn PENDING.
 * 2. Tự động hủy các đơn thanh toán trả trước (PAYOS/VNPAY) quá 30 phút chưa thanh toán,
 *    hoàn lại số lượng tồn kho (stock) và nhả lại lượt dùng voucher.
 */
export class PayosPaymentReconcileJob {
    private static timer: NodeJS.Timeout | undefined;
    private static running = false;

    static start(intervalMs = 60_000): void {
        if (this.timer) return;
        this.timer = setInterval(() => void this.runOnce(), intervalMs);
        this.timer.unref();
    }

    static stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }

    /** Trả về số đơn vừa được ghi nhận đã thanh toán hoặc đã hủy. */
    static async runOnce(now = new Date()): Promise<number> {
        if (!isMongoReady() || this.running) return 0;
        this.running = true;
        let processedCount = 0;
        try {
            // 1. Đối soát các đơn PayOS PENDING còn trong thời hạn 30 phút
            if (payosService.configured()) {
                const pendingPayos = await Order.find({
                    payment_method: 'PAYOS',
                    payment_status: 'PENDING',
                    order_status: { $ne: 'CANCELLED' },
                    'payos_order_codes.0': { $exists: true },
                    created_at: {
                        $gte: new Date(now.getTime() - UNPAID_EXPIRE_MS),
                        $lte: now
                    },
                }).select('_id order_code').limit(30).lean();

                for (const order of pendingPayos) {
                    try {
                        const { paymentStatus } = await payosService.syncPayment({ orderId: String(order._id) });
                        if (paymentStatus === 'PAID') processedCount += 1;
                    } catch (error) {
                        logger.error(`[PAYOS PAYMENT RECONCILE] #${order.order_code}: ${error instanceof Error ? error.message : error}`);
                    }
                }
            }

            // 2. Tự động hủy các đơn trả trước (PAYOS / VNPAY) quá 30 phút chưa thanh toán
            const expiredUnpaidOrders = await Order.find({
                payment_method: { $in: ['PAYOS', 'VNPAY'] },
                payment_status: 'PENDING',
                order_status: { $in: ['ORDERED', 'PENDING_DESIGN', 'PENDING_APPROVAL'] },
                created_at: {
                    $lt: new Date(now.getTime() - UNPAID_EXPIRE_MS),
                    $gte: new Date(now.getTime() - LOOKBACK_MS)
                }
            }).limit(30);

            for (const order of expiredUnpaidOrders) {
                try {
                    // Nếu là PayOS, thử đối soát lần cuối trước khi quyết định hủy
                    if (order.payment_method === 'PAYOS' && payosService.configured() && order.payos_order_codes?.length) {
                        try {
                            const { paymentStatus } = await payosService.syncPayment({ orderId: String(order._id) });
                            if (paymentStatus === 'PAID') {
                                processedCount += 1;
                                continue;
                            }
                        } catch { }
                    }

                    order.order_status = 'CANCELLED';
                    order.fulfillment_status = 'CANCELLED';
                    order.seller_approval_status = 'REJECTED';
                    order.status_history.push({
                        status: 'CANCELLED',
                        changed_at: new Date(),
                        note: 'Hệ thống tự động hủy do quá hạn 30 phút chưa hoàn tất thanh toán.'
                    });

                    await order.save();

                    // Hoàn lại kho và voucher
                    await OrdersService.restoreOrderStockAndCoupon(order);
                    processedCount += 1;

                    logger.info(`[AUTO-CANCEL] Đơn hàng #${order.order_code} đã tự động hủy do quá hạn 30 phút.`);

                    if (order.buyer_id) {
                        await notificationService.createNotification({
                            user_id: order.buyer_id.toString(),
                            type: 'ORDER_UPDATE',
                            title: 'Đơn hàng đã tự động hủy',
                            content: `Đơn hàng #${order.order_code} đã tự động hủy do quá thời hạn thanh toán (30 phút).`,
                            link: `/orders/${order._id}`,
                            metadata: { orderId: order._id.toString(), orderCode: order.order_code, status: 'CANCELLED' }
                        }).catch(() => { });
                    }
                } catch (error) {
                    logger.error(`[AUTO-CANCEL ERROR] #${order.order_code}: ${error instanceof Error ? error.message : error}`);
                }
            }
        } catch (error) {
            logger.error(`[PAYOS PAYMENT RECONCILE] ${error instanceof Error ? error.message : error}`);
        } finally {
            this.running = false;
        }
        return processedCount;
    }
}
