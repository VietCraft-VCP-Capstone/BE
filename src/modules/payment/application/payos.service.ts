import { PayOS, Webhook } from '@payos/node';
import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';
import { CreatePayosPaymentDto, PayosPaymentResult, PayosWebhookOutcome } from '../types/payos.types';
import { Order, IOrder } from '../../order/infrastructure/models/order.model';
import { Transaction } from '../../order/infrastructure/models/transaction.model';
import { byCodeOrId, num, dec } from '../../order/utils';
import { dispatchToPrinter } from '../../order/application/printer-dispatch.service';
import { notificationService } from '../../notification';
import { Shop } from '../../product/infrastructure/models/shop.model';

/** Phần SDK thu tiền mà service dùng; test thay bằng bản giả qua `useClient`. */
export type PayosCollectionSdk = Pick<PayOS, 'paymentRequests' | 'webhooks'>;

/** payOS giới hạn description 25 ký tự. */
const DESCRIPTION_MAX = 25;

const text = (value: unknown) => String(value ?? '').trim();

const isBin = (v: string) => /^\d{6}$/.test(v);
const isAccountNo = (v: string) => /^\d{6,19}$/.test(v);

export class PayosService {
    private client?: PayosCollectionSdk;

    configured(): boolean {
        return Boolean(config.payos.clientId && config.payos.apiKey && config.payos.checksumKey);
    }

    /** Thay SDK thật bằng client khác. Chỉ dùng cho test. */
    useClient(client: PayosCollectionSdk): void {
        this.client = client;
    }

    private sdk(): PayosCollectionSdk {
        if (!this.client) {
            if (!this.configured()) throw new Error('payos_not_configured');
            this.client = new PayOS({
                clientId: config.payos.clientId,
                apiKey: config.payos.apiKey,
                checksumKey: config.payos.checksumKey,
                baseURL: config.payos.baseUrl,
                timeout: 15_000,
                maxRetries: 2,
                logLevel: 'warn',
            });
        }
        return this.client;
    }

    private calculateOrderTotal(order: IOrder): number {
        const subtotal = num(order.financial_breakdown?.subtotal);
        const shippingFee = num(order.financial_breakdown?.shipping_fee);
        const discount = num(order.financial_breakdown?.coupon_discount);
        return Math.max(0, subtotal + shippingFee - discount);
    }

    /** payOS yêu cầu orderCode là số nguyên duy nhất (<= 2^53-1); order_code của mình là chuỗi nên cấp mã số riêng cho mỗi link. */
    private newPayosOrderCode(): number {
        return Date.now() * 1000 + Math.floor(Math.random() * 1000);
    }

    /**
     * Tài khoản đã dùng để trả tiền, để hoàn tiền về đúng nguồn. Lấy từ webhook đã lưu; thiếu thì
     * hỏi lại payOS theo mã link. Không có hoặc sai định dạng thì trả undefined (không đoán).
     */
    async resolveRefundDestination(order: { payos_order_codes?: number[] }, tx?: { callback_payload?: Record<string, any> } | null) {
        const pick = (src?: Record<string, any>) => {
            const bin = text(src?.counterAccountBankId);
            const accountNo = text(src?.counterAccountNumber).replace(/\s+/g, '');
            return isBin(bin) && isAccountNo(accountNo)
                ? { bin, accountNo, accountName: text(src?.counterAccountName) || undefined }
                : undefined;
        };
        const fromWebhook = pick(tx?.callback_payload);
        if (fromWebhook) return fromWebhook;

        const code = Number(tx?.callback_payload?.orderCode) || order.payos_order_codes?.[order.payos_order_codes.length - 1];
        if (!code) return undefined;
        try {
            const link = await this.sdk().paymentRequests.get(code);
            return pick(link.transactions?.[0] as unknown as Record<string, any>);
        } catch (err: any) {
            logger.warn(`[PayOS] Không lấy được tài khoản thanh toán của link ${code}: ${err?.message}`);
            return undefined;
        }
    }

    /**
     * Tạo link thanh toán payOS (VietQR). FE redirect người mua tới `checkoutUrl`.
     */
    async createPayment(dto: CreatePayosPaymentDto): Promise<PayosPaymentResult> {
        const order = await Order.findOne(byCodeOrId(dto.orderId));
        if (!order) throw new Error(`Đơn hàng không tồn tại: ${dto.orderId}`);
        if (dto.buyerId && order.buyer_id.toString() !== dto.buyerId) {
            throw new Error('Bạn không có quyền thanh toán đơn hàng này.');
        }
        if (order.payment_method !== 'PAYOS') {
            throw new Error('Đơn hàng này không chọn thanh toán bằng payOS.');
        }
        if (order.payment_status === 'PAID') {
            throw new Error('Đơn hàng đã được thanh toán thành công trước đó.');
        }
        if (order.order_status === 'CANCELLED') {
            throw new Error('Đơn hàng đã bị huỷ.');
        }

        const amount = Math.round(this.calculateOrderTotal(order));
        if (amount <= 0) throw new Error('Số tiền đơn hàng không hợp lệ (phải lớn hơn 0).');

        const sdk = this.sdk();

        // Huỷ các link cũ chưa trả (best effort) để một đơn không bị thanh toán hai lần.
        for (const oldCode of order.payos_order_codes || []) {
            await sdk.paymentRequests.cancel(oldCode, 'Tạo link thanh toán mới').catch(() => undefined);
        }

        const payosOrderCode = this.newPayosOrderCode();
        const base = config.payos.checkoutReturnUrl || `${config.frontendUrl}/orders/${order._id}`;
        const cancelBase = config.payos.checkoutCancelUrl || `${config.frontendUrl}/orders/${order._id}?payment=cancelled`;

        let link;
        try {
            link = await sdk.paymentRequests.create({
                orderCode: payosOrderCode,
                amount,
                description: order.order_code.slice(0, DESCRIPTION_MAX),
                returnUrl: base,
                cancelUrl: cancelBase,
                // Link tự hết hạn sau 15 phút.
                expiredAt: Math.floor(Date.now() / 1000) + 15 * 60,
            });
        } catch (err: any) {
            logger.error(`[PayOS] create payment failed for #${order.order_code}: ${err?.desc || err?.message}`);
            throw new Error('Không thể tạo link thanh toán payOS. Vui lòng thử lại.');
        }

        // Ghi mã trước khi trả link để webhook luôn tìm được đơn.
        await Order.updateOne({ _id: order._id }, { $addToSet: { payos_order_codes: payosOrderCode } });

        logger.info(`[PayOS] Generated checkout link for Order #${order.order_code} (Amount: ${amount} VND)`);
        return {
            checkoutUrl: link.checkoutUrl,
            qrCode: link.qrCode,
            paymentLinkId: link.paymentLinkId,
            expiredAt: link.expiredAt,
        };
    }

    /**
     * Xử lý webhook payOS (chống race & idempotent). payOS chỉ gọi webhook khi tiền đã về;
     * huỷ/hết hạn chỉ qua cancelUrl nên đơn vẫn PENDING để người mua thanh toán lại.
     */
    async handleWebhook(body: Webhook): Promise<PayosWebhookOutcome> {
        let data;
        try {
            data = await this.sdk().webhooks.verify(body);
        } catch (err: any) {
            logger.warn(`[PayOS Webhook] Verification failed: ${err?.message}`);
            return 'INVALID_SIGNATURE';
        }

        // Webhook thử khi đăng ký URL mang orderCode giả; trả 200 để payOS chấp nhận URL.
        const order = await Order.findOne({ payos_order_codes: data.orderCode });
        if (!order) {
            logger.info(`[PayOS Webhook] Không có đơn nào ứng với orderCode ${data.orderCode} (có thể là webhook thử).`);
            return 'IGNORED';
        }

        if (!body.success || data.code !== '00') {
            logger.info(`[PayOS Webhook] Bỏ qua webhook không thành công cho #${order.order_code} (code: ${data.code})`);
            return 'IGNORED';
        }

        const paidAmount = Number(data.amount);
        const expectedAmount = this.calculateOrderTotal(order);
        if (Math.round(expectedAmount) !== Math.round(paidAmount)) {
            // Retry không thay đổi được kết quả; để đối soát thủ công.
            logger.error(`[PayOS Webhook] Sai số tiền cho ${order.order_code}. Expected: ${expectedAmount}, Received: ${paidAmount}, ref: ${data.reference}`);
            return 'IGNORED';
        }

        await this.settlePaid(order, {
            amount: paidAmount,
            reference: String(data.reference || ''),
            paidAt: this.parsePaidAt(data.transactionDateTime),
            responseCode: data.code,
            payload: data as unknown as Record<string, any>,
        });
        return 'PROCESSED';
    }

    /**
     * Hỏi payOS trạng thái các link của đơn và ghi nhận nếu đã trả. Webhook không tới được
     * (BE chạy local, URL webhook chưa đăng ký, payOS gửi trễ) thì đây là đường xác nhận
     * thay thế: API payOS được ký bằng credential của mình nên tin được như webhook.
     */
    async syncPayment(dto: { orderId: string; buyerId?: string }): Promise<{ paymentStatus: string }> {
        const order = await Order.findOne(byCodeOrId(dto.orderId));
        if (!order) throw new Error(`Đơn hàng không tồn tại: ${dto.orderId}`);
        if (dto.buyerId && order.buyer_id.toString() !== dto.buyerId) {
            throw new Error('Bạn không có quyền xem đơn hàng này.');
        }
        if (order.payment_method !== 'PAYOS' || order.payment_status !== 'PENDING') {
            return { paymentStatus: order.payment_status };
        }

        const expectedAmount = Math.round(this.calculateOrderTotal(order));
        // Link mới nhất trước: khách thường trả bằng link vừa tạo.
        for (const code of [...(order.payos_order_codes || [])].reverse()) {
            let link;
            try {
                link = await this.sdk().paymentRequests.get(code);
            } catch (err: any) {
                logger.warn(`[PayOS Sync] Không tra được link ${code} của #${order.order_code}: ${err?.message}`);
                continue;
            }
            if (link.status !== 'PAID') continue;
            if (Math.round(Number(link.amount)) !== expectedAmount || Number(link.amountPaid) < expectedAmount) {
                logger.error(`[PayOS Sync] Link ${code} của #${order.order_code} đã trả nhưng lệch số tiền (link ${link.amount}, đã trả ${link.amountPaid}, đơn ${expectedAmount}).`);
                continue;
            }
            const tx = link.transactions?.[0];
            await this.settlePaid(order, {
                amount: Number(link.amountPaid),
                reference: String(tx?.reference || link.id),
                paidAt: this.parsePaidAt(tx?.transactionDateTime),
                responseCode: '00',
                // Giữ orderCode và tài khoản người trả để hoàn tiền tra lại được (resolveRefundDestination).
                payload: { source: 'sync', orderCode: link.orderCode, paymentLinkId: link.id, ...(tx || {}) },
            });
            break;
        }

        const fresh = await Order.findById(order._id).select('payment_status').lean();
        return { paymentStatus: fresh?.payment_status || order.payment_status };
    }

    /** Webhook gửi "yyyy-MM-dd HH:mm:ss" giờ Việt Nam; API tra cứu có thể trả chuỗi ISO. */
    private parsePaidAt(value?: string | null): Date {
        const raw = text(value);
        const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? new Date(`${raw.replace(' ', 'T')}+07:00`) : new Date(raw);
        return raw && !Number.isNaN(date.getTime()) ? date : new Date();
    }

    /** Chuyển đơn sang PAID đúng một lần (webhook và tra cứu có thể chạy đồng thời). */
    private async settlePaid(
        order: IOrder,
        info: { amount: number; reference: string; paidAt: Date; responseCode: string; payload: Record<string, any> },
    ): Promise<boolean> {
        if (order.payment_status !== 'PENDING') return false;

        const orderCode = order.order_code;
        const { amount: paidAmount, reference } = info;

        const preOrder = await Order.findOne({ order_code: orderCode }).populate('shop_id');
        const shopData = preOrder?.shop_id as any;
        const isPod = Boolean(preOrder?.is_pod || preOrder?.order_type === 'POD' || preOrder?.items?.some((it: any) => it.design_file_url));
        const isAutoApprove = isPod && Boolean(shopData?.printer_partner?.auto_approve);

        const updatedOrder = await Order.findOneAndUpdate(
            { order_code: orderCode, payment_status: 'PENDING' },
            {
                $set: {
                    payment_status: 'PAID',
                    order_status: isAutoApprove ? 'PROCESSING' : 'ORDERED',
                    seller_approval_status: isAutoApprove ? 'APPROVED' : 'PENDING_APPROVAL',
                    fulfillment_status: isAutoApprove ? 'QUEUED' : (isPod ? 'PENDING_APPROVAL' : 'UNFULFILLED'),
                },
                $push: {
                    status_history: {
                        status: isAutoApprove ? 'PROCESSING' : 'ORDERED',
                        changed_at: new Date(),
                        note: isAutoApprove
                            ? `payOS: Thanh toán thành công (Mã GD: ${reference}). Đã tự động duyệt đơn và chuyển sang xưởng in.`
                            : isPod
                            ? `payOS: Thanh toán thành công (Mã GD: ${reference}). Đơn hàng POD đang chờ người bán duyệt in.`
                            : `payOS: Thanh toán thành công (Mã GD: ${reference}). Đơn hàng đang chờ người bán duyệt đơn chuẩn bị hàng.`,
                    },
                },
            },
            { new: true },
        );

        // Tiến trình khác vừa xử lý xong.
        if (!updatedOrder) return false;

        await Transaction.create({
            order_id: updatedOrder._id,
            order_code: updatedOrder.order_code,
            user_id: updatedOrder.buyer_id,
            gateway: 'PAYOS',
            gateway_transaction_id: reference,
            gateway_bank_code: info.payload.counterAccountBankId || undefined,
            gateway_response_code: info.responseCode,
            amount: dec(paidAmount),
            type: 'PAYMENT',
            status: 'SUCCESS',
            payment_date: info.paidAt,
            callback_payload: info.payload,
            note: `Thanh toán thành công qua payOS #${reference}`,
        });

        if (isPod && isAutoApprove) {
            dispatchToPrinter(updatedOrder).catch((err: any) =>
                logger.error(`[PayOS Dispatch] Lỗi gửi đơn sang xưởng in: ${err?.message || err}`),
            );
        }

        try {
            await notificationService.createNotification({
                user_id: updatedOrder.buyer_id.toString(),
                type: 'ORDER_UPDATE',
                title: 'Thanh toán thành công',
                content: isAutoApprove
                    ? `Đơn hàng #${updatedOrder.order_code} đã thanh toán thành công qua payOS và chuyển sang xưởng sản xuất.`
                    : `Đơn hàng #${updatedOrder.order_code} đã thanh toán thành công qua payOS và đang chờ người bán xác nhận.`,
                link: `/orders/${updatedOrder._id}`,
                metadata: { orderId: updatedOrder._id.toString(), orderCode: updatedOrder.order_code, status: updatedOrder.order_status },
            });

            if (updatedOrder.shop_id) {
                const shop = await Shop.findById(updatedOrder.shop_id);
                if (shop?.owner_id) {
                    await notificationService.createNotification({
                        user_id: shop.owner_id.toString(),
                        type: 'ORDER_UPDATE',
                        title: isAutoApprove ? 'Đơn hàng mới đã thanh toán' : 'Đơn hàng mới cần duyệt',
                        content: isAutoApprove
                            ? `Đơn hàng #${updatedOrder.order_code} (${paidAmount.toLocaleString('vi-VN')}₫) đã được thanh toán và tự động gửi xưởng in.`
                            : `Đơn hàng #${updatedOrder.order_code} (${paidAmount.toLocaleString('vi-VN')}₫) đã được thanh toán qua payOS và đang chờ bạn duyệt.`,
                        link: `/seller/orders`,
                        metadata: { orderId: updatedOrder._id.toString(), orderCode: updatedOrder.order_code, status: 'PENDING_APPROVAL' },
                    });
                }
            }
        } catch (notiErr: any) {
            logger.error(`[PayOS] Lỗi tạo thông báo: ${notiErr.message}`);
        }

        logger.info(`[PayOS] Ghi nhận thanh toán thành công cho đơn #${orderCode} (Mã GD: ${reference})`);
        return true;
    }
}

export const payosService = new PayosService();
