import crypto from 'crypto';
import mongoose from 'mongoose';
import { config } from '../../../app/config';
import { AuthUser } from '../../../app/types/auth';
import { logger } from '../../../shared/utils/logger';
import { notificationService } from '../../notification';
import { Order, IOrder } from '../../order/infrastructure/models/order.model';
import { Transaction } from '../../order/infrastructure/models/transaction.model';
import { FulfillmentJob } from '../../order/infrastructure/models/fulfillment-job.model';
import { dispatchToPrinter } from '../../order/application/printer-dispatch.service';
import { byCodeOrId, dec, num } from '../../order/utils';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { bankNameOf, binOf, isBin } from '../domain/bank-bins';
import {
    existingRefundReason,
    RefundBlockedReason,
    refundableUntil,
    refundBlockedReason,
} from '../domain/refund-eligibility';
import { buildVietQr, sanitizeTransferContent } from '../domain/vietqr';
import { Refund, IRefund, IRefundDestination } from '../infrastructure/models/refund.model';
import { PayOSPayoutResult, payosPayoutService } from './payos-payout.service';
import { refundError } from './refund.error';
import { RefundLedgerService } from './refund-ledger.service';

export interface CreateRefundInput {
    orderId: string;
    reason?: string;
    destBankBin?: string;
    destBankName?: string;
    destAccountNo?: string;
    destAccountName?: string;
}

export interface RefundListQuery {
    status?: string;
    page?: number;
    limit?: number;
}

const MAX_PAGE_SIZE = 100;

const BLOCKED_MESSAGES: Record<RefundBlockedReason, string> = {
    already_refunded: 'Đơn hàng đã được hoàn tiền',
    not_paid: 'Đơn hàng chưa thanh toán',
    order_canceled: 'Đơn hàng đã bị huỷ',
    refund_in_progress: 'Đơn hàng đang có yêu cầu hoàn tiền',
    refund_canceled: 'Yêu cầu hoàn tiền của đơn này đã kết thúc',
    payment_time_missing: 'Không xác định được thời điểm thanh toán của đơn',
    window_closed: 'Đã hết thời hạn yêu cầu hoàn tiền',
};

const blockedError = (reason: RefundBlockedReason) => refundError(reason, BLOCKED_MESSAGES[reason]);

function objectId(value: string, reason = 'invalid_user'): mongoose.Types.ObjectId {
    if (!mongoose.Types.ObjectId.isValid(value)) throw refundError(reason, 'Định danh không hợp lệ', 400);
    return new mongoose.Types.ObjectId(value);
}

function clean(value: unknown): string {
    return String(value || '').trim();
}

function stableHash(input: CreateRefundInput): string {
    const normalized = {
        orderId: clean(input.orderId),
        reason: clean(input.reason),
        destBankBin: clean(input.destBankBin),
        destBankName: clean(input.destBankName),
        destAccountNo: clean(input.destAccountNo),
        destAccountName: clean(input.destAccountName),
    };
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function totalOf(order: IOrder): number {
    return Math.max(0, Math.round(
        num(order.financial_breakdown?.subtotal)
        + num(order.financial_breakdown?.shipping_fee)
        - num(order.financial_breakdown?.coupon_discount),
    ));
}

function duplicateKey(error: any): boolean {
    return error?.code === 11000 || error?.name === 'MongoServerError' && error?.code === 11000;
}

export class RefundService {
    private static async originalPayment(orderId: mongoose.Types.ObjectId) {
        return Transaction.findOne({
            order_id: orderId,
            type: 'PAYMENT',
            status: 'SUCCESS',
        }).sort({ created_at: -1 });
    }

    /** Thời điểm và số tiền thực nhận; refund window tính từ paid_at do provider xác nhận. */
    private static async paymentInfo(order: IOrder) {
        const payment = await this.originalPayment(order._id);
        const paidAt = order.paid_at || payment?.payment_date || payment?.created_at || null;
        const amount = totalOf(order);
        const paidAmount = payment ? Math.round(num(payment.amount)) : amount;
        return { paidAt, amount, paidAmount };
    }

    private static async replay(
        idempotencyKey: string,
        hash: string,
        buyerId: mongoose.Types.ObjectId,
    ): Promise<IRefund | null> {
        const existing = await Refund.findOne({ idempotency_key: idempotencyKey });
        if (!existing) return null;
        // Key của người khác cũng là xung đột: không được trả refund của buyer khác ra ngoài.
        if (existing.request_hash !== hash || !existing.requested_by.equals(buyerId)) {
            throw refundError(
                'idempotency_conflict',
                'Idempotency-Key đã được dùng với nội dung yêu cầu khác',
                409,
            );
        }
        return existing;
    }

    /**
     * Tài khoản nhận hoàn trùng tài khoản nền tảng hoặc bất kỳ tài khoản nào của shop thì tiền
     * chạy vòng (hoặc seller tự hoàn cho mình). Shop lưu mã viết tắt (VCB, MB...) nên phải đổi
     * sang BIN; mã lạ thì chỉ so số tài khoản.
     */
    private static async isMerchantAccount(
        shopId: mongoose.Types.ObjectId,
        dest: IRefundDestination,
    ): Promise<boolean> {
        const same = (bankCode: unknown, accountNo: unknown) => {
            const account = String(accountNo || '').replace(/\s+/g, '');
            if (!account || account !== dest.account_no) return false;
            const bin = binOf(String(bankCode || ''));
            return !bin || bin === dest.bank_bin;
        };
        if (config.refund.merchantAccountNo && same(config.refund.merchantBankBin, config.refund.merchantAccountNo)) {
            return true;
        }
        const shop = await Shop.findById(shopId).select('bank_info settings').lean();
        if (shop?.bank_info && same(shop.bank_info.bank_code, shop.bank_info.account_number)) return true;
        const accounts: any[] = (shop?.settings as any)?.payment?.bankAccounts || [];
        return accounts.some(account => same(account?.bankCode, account?.accountNumber));
    }

    static async create(buyerId: string, input: CreateRefundInput, idempotencyKey: string) {
        const key = clean(idempotencyKey);
        if (key.length < 8 || key.length > 200) {
            throw refundError('invalid_idempotency_key', 'Idempotency-Key phải dài từ 8 đến 200 ký tự', 400);
        }
        if (!clean(input.orderId)) throw refundError('invalid_order', 'Thiếu orderId', 400);

        const buyerObjectId = objectId(buyerId);
        const requestHash = stableHash(input);
        const replay = await this.replay(key, requestHash, buyerObjectId);
        if (replay) return { refund: await this.toView(replay), replayed: true };

        const order = await Order.findOne({ ...byCodeOrId(input.orderId), buyer_id: buyerObjectId });
        if (!order) throw refundError('order_not_found', 'Không tìm thấy đơn hàng', 404);

        const [existingForOrder, { paidAt, amount, paidAmount }] = await Promise.all([
            Refund.findOne({ order_id: order._id }).select('status').lean(),
            this.paymentInfo(order),
        ]);
        const blocked = refundBlockedReason({
            paymentStatus: order.payment_status,
            orderStatus: order.order_status,
            paidAt,
            existingRefundStatus: existingForOrder?.status,
            now: new Date(),
            windowSeconds: config.refund.windowSeconds,
        });
        if (blocked) throw blockedError(blocked);

        if (amount <= 0) throw refundError('invalid_amount', 'Số tiền hoàn không hợp lệ');
        if (paidAmount < amount) {
            throw refundError('amount_out_of_range', 'Số tiền đã nhận nhỏ hơn số tiền cần hoàn');
        }

        const executor = payosPayoutService.activeExecutor();

        // VietCraft thu tiền qua VNPay/MOMO/COD, không có webhook payOS mang tài khoản đối ứng
        // của buyer như MVP. Buyer luôn tự nhập tài khoản (dest_source = buyer_input), nên
        // theo edge 16 của spec, seller/admin phải duyệt trước khi tiền rời ví payout.
        const bankBin = clean(input.destBankBin);
        const destination: IRefundDestination = {
            bank_bin: bankBin,
            bank_name: clean(input.destBankName) || bankNameOf(bankBin),
            account_no: clean(input.destAccountNo).replace(/\s+/g, ''),
            account_name: clean(input.destAccountName),
        };
        if (!isBin(destination.bank_bin)) {
            throw refundError('invalid_bank_bin', 'Mã BIN ngân hàng phải gồm 6 chữ số', 400);
        }
        if (!/^\d{6,19}$/.test(destination.account_no || '')) {
            throw refundError('invalid_account_no', 'Số tài khoản phải gồm 6–19 chữ số', 400);
        }
        if (!destination.account_name) {
            throw refundError('invalid_account_name', 'Thiếu tên chủ tài khoản nhận hoàn tiền', 400);
        }
        if (await this.isMerchantAccount(order.shop_id, destination)) {
            throw refundError('dest_is_merchant', 'Tài khoản nhận hoàn không được trùng tài khoản người bán');
        }

        const reason = clean(input.reason) || 'Khách hàng yêu cầu hoàn tiền';
        if (reason.length > 500) throw refundError('invalid_reason', 'Lý do hoàn tiền tối đa 500 ký tự', 400);

        let refund: IRefund;
        try {
            refund = await Refund.create({
                order_id: order._id,
                order_code: order.order_code,
                buyer_id: order.buyer_id,
                shop_id: order.shop_id,
                amount,
                paid_amount: paidAmount,
                reason,
                status: 'REQUESTED',
                executor,
                destination,
                idempotency_key: key,
                request_hash: requestHash,
                // refundBlockedReason đã chặn payment_time_missing nên paidAt chắc chắn có.
                paid_at: paidAt!,
                refundable_until: refundableUntil(paidAt, config.refund.windowSeconds)!,
                requested_by: buyerObjectId,
            });
        } catch (error: any) {
            // Unique index trên order_id và idempotency_key là chốt cuối cho double-click:
            // hai request song song chỉ một bên insert được, bên kia nhận replay hoặc 422.
            if (!duplicateKey(error)) throw error;
            const racedReplay = await this.replay(key, requestHash, buyerObjectId);
            if (racedReplay) return { refund: await this.toView(racedReplay), replayed: true };
            const racedOrder = await Refund.findOne({ order_id: order._id }).select('status').lean();
            const raced = existingRefundReason(racedOrder?.status);
            if (raced) throw blockedError(raced);
            throw error;
        }

        // Job chưa gửi sang xưởng được tạm dừng trong lúc chờ seller/admin quyết định.
        // Job PROCESSING/COMPLETED không đụng tới vì lúc đó cần xử lý với xưởng bằng quy
        // trình riêng, không được giả vờ rằng chỉ đổi trạng thái local là đã huỷ sản xuất.
        await FulfillmentJob.updateMany(
            { order_id: order._id, status: 'PENDING' },
            { $set: { status: 'FAILED', last_error: `REFUND_REQUESTED:${refund._id}` } },
        );

        this.notifySeller(refund, 'Yêu cầu hoàn tiền mới', `Đơn #${order.order_code} có yêu cầu hoàn ${amount.toLocaleString('vi-VN')}₫.`);
        return { refund: await this.toView(refund), replayed: false };
    }

    /**
     * Trạng thái nút "Hoàn tiền" cho buyer. Cùng rule với create nên FE và server không lệch nhau;
     * countdown trên FE chỉ để hiển thị, quyết định cuối cùng vẫn là POST /refunds.
     */
    static async eligibility(buyerId: string, orderId: string) {
        const order = await Order.findOne({ ...byCodeOrId(clean(orderId)), buyer_id: objectId(buyerId) });
        if (!order) throw refundError('order_not_found', 'Không tìm thấy đơn hàng', 404);
        const [refund, { paidAt, amount }] = await Promise.all([
            Refund.findOne({ order_id: order._id }),
            this.paymentInfo(order),
        ]);
        const now = new Date();
        const reason = refundBlockedReason({
            paymentStatus: order.payment_status,
            orderStatus: order.order_status,
            paidAt,
            existingRefundStatus: refund?.status,
            now,
            windowSeconds: config.refund.windowSeconds,
        });
        return {
            orderId: String(order._id),
            orderCode: order.order_code,
            amount,
            paidAt,
            refundableUntil: refundableUntil(paidAt, config.refund.windowSeconds),
            // FE dùng để bù lệch đồng hồ máy khách khi đếm ngược.
            serverTime: now,
            refundWindowSeconds: config.refund.windowSeconds,
            refundEligible: reason === null,
            refundBlockedReason: reason,
            // Không có tài khoản đối ứng từ webhook nên buyer luôn phải nhập tài khoản nhận.
            destinationRequired: true,
            executor: payosPayoutService.activeExecutor(),
            refund: refund ? await this.toView(refund) : null,
        };
    }

    private static async managerFilter(actor: AuthUser): Promise<Record<string, unknown>> {
        const role = clean(actor.role).toLowerCase();
        if (role === 'admin') return {};
        if (role !== 'seller') throw refundError('forbidden', 'Bạn không có quyền xử lý hoàn tiền', 403);
        const shop = await Shop.findOne({ owner_id: objectId(actor.id) }).select('_id').lean();
        if (!shop) throw refundError('shop_required', 'Không tìm thấy gian hàng của bạn', 403);
        return { shop_id: shop._id };
    }

    private static async manageable(id: string, actor: AuthUser): Promise<IRefund> {
        if (!mongoose.Types.ObjectId.isValid(id)) throw refundError('refund_not_found', 'Không tìm thấy yêu cầu hoàn tiền', 404);
        const scope = await this.managerFilter(actor);
        const refund = await Refund.findOne({ _id: new mongoose.Types.ObjectId(id), ...scope });
        if (!refund) throw refundError('refund_not_found', 'Không tìm thấy yêu cầu hoàn tiền', 404);
        return refund;
    }

    static async get(id: string, actor: AuthUser) {
        if (!mongoose.Types.ObjectId.isValid(id)) throw refundError('refund_not_found', 'Không tìm thấy yêu cầu hoàn tiền', 404);
        const refundId = new mongoose.Types.ObjectId(id);
        // Seller cũng có thể đi mua hàng, nên refund của chính mình luôn xem được, sau đó
        // mới tới phạm vi quản lý (shop của seller, hoặc toàn hệ thống với admin).
        let refund = await Refund.findOne({ _id: refundId, buyer_id: objectId(actor.id) });
        const role = clean(actor.role).toLowerCase();
        if (!refund && (role === 'seller' || role === 'admin')) {
            const scope = await this.managerFilter(actor).catch(() => null);
            if (scope) refund = await Refund.findOne({ _id: refundId, ...scope });
        }
        if (!refund) throw refundError('refund_not_found', 'Không tìm thấy yêu cầu hoàn tiền', 404);
        return this.toView(refund);
    }

    static async listMine(buyerId: string, query: RefundListQuery) {
        return this.listWithScope({ buyer_id: objectId(buyerId) }, query);
    }

    static async listManaged(actor: AuthUser, query: RefundListQuery) {
        return this.listWithScope(await this.managerFilter(actor), query);
    }

    private static async listWithScope(scope: Record<string, unknown>, query: RefundListQuery) {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.limit) || 20));
        const filter: Record<string, unknown> = { ...scope };
        const status = clean(query.status).toUpperCase();
        if (status) filter.status = status;
        const [items, total] = await Promise.all([
            Refund.find(filter).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit),
            Refund.countDocuments(filter),
        ]);
        return {
            items: await Promise.all(items.map(item => this.toView(item))),
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    static async approve(id: string, actor: AuthUser) {
        const current = await this.manageable(id, actor);
        if (current.status !== 'REQUESTED' && current.status !== 'APPROVED') {
            throw refundError('invalid_state', `Chỉ duyệt được refund REQUESTED/APPROVED; hiện tại là ${current.status}`);
        }
        const now = new Date();
        let approved = current;
        if (current.status === 'REQUESTED') {
            const claimed = await Refund.findOneAndUpdate(
                { _id: current._id, status: 'REQUESTED' },
                {
                    $set: {
                        status: 'APPROVED',
                        approved_by: objectId(actor.id),
                        approved_at: now,
                        hold_placed: true,
                    },
                },
                { new: true },
            );
            if (!claimed) throw refundError('refund_in_progress', 'Yêu cầu đã được tiến trình khác xử lý', 409);
            approved = claimed;
        }

        await RefundLedgerService.append({
            uniqueKey: `payment:${approved.order_id}`,
            orderId: approved.order_id,
            type: 'PAYMENT_IN',
            amount: approved.paid_amount,
            reference: approved.order_code,
        });
        await RefundLedgerService.append({
            uniqueKey: `hold:${approved._id}`,
            orderId: approved.order_id,
            refundId: approved._id,
            type: 'REFUND_HOLD',
            amount: approved.amount,
            reference: `refund:${approved._id}`,
        });
        await RefundLedgerService.assertInvariant(approved.order_id);

        const nextAttempt = approved.attempt_count + 1;
        const reference = approved.executor === 'PAYOS_PAYOUT'
            ? payosPayoutService.referenceFor(approved.order_code, nextAttempt)
            : `MANUAL-${approved._id}`;
        const executing = await Refund.findOneAndUpdate(
            { _id: approved._id, status: 'APPROVED' },
            {
                $set: {
                    status: 'EXECUTING',
                    executed_at: now,
                    provider_reference: reference,
                    failure_reason: null,
                },
                $inc: { attempt_count: 1 },
            },
            { new: true },
        );
        if (!executing) throw refundError('refund_in_progress', 'Yêu cầu đã được tiến trình khác xử lý', 409);
        return this.runExecutor(executing);
    }

    private static async runExecutor(refund: IRefund) {
        if (refund.executor === 'MANUAL_VIETQR') {
            return this.toView(refund);
        }
        let result: PayOSPayoutResult;
        try {
            result = await payosPayoutService.execute(refund);
        } catch (error: any) {
            // Không biết payout đã được tạo hay chưa, nên không được đánh FAILED (Retry sẽ trả
            // tiền lần hai). Giữ EXECUTING để reconcile tra theo reference.
            logger.error(`[REFUND] Executor lỗi cho refund ${refund._id}: ${error?.stack || error?.message}`);
            result = {
                outcome: 'UNKNOWN',
                referenceId: refund.provider_reference || '',
                failureReason: 'payout_outcome_unknown',
            };
        }
        if (result.outcome === 'UNKNOWN') {
            // SDK có thể đã tự retry nhiều lần; mốc grace "không tìm thấy payout" của reconcile
            // phải tính từ sau đó, nếu không sẽ kết luận FAILED quá sớm.
            const now = new Date();
            await Refund.updateOne({ _id: refund._id, status: 'EXECUTING' }, { $set: { executed_at: now } });
            refund.executed_at = now;
        }
        return this.applyPayOSResult(refund, result);
    }

    private static async applyPayOSResult(refund: IRefund, result: PayOSPayoutResult) {
        const common = {
            provider_reference: result.referenceId,
            provider_payout_id: result.payoutId || refund.provider_payout_id,
        };
        if (result.outcome === 'SUCCESS') {
            const updated = await Refund.findOneAndUpdate(
                { _id: refund._id, status: 'EXECUTING' },
                { $set: { ...common, failure_reason: null } },
                { new: true },
            );
            return this.settleInternal(updated || refund, result.evidenceRef || result.payoutId || result.referenceId);
        }
        if (result.outcome === 'FAILED') {
            const failed = await Refund.findOneAndUpdate(
                { _id: refund._id, status: 'EXECUTING' },
                { $set: { ...common, status: 'FAILED', failure_reason: result.failureReason || 'payout_failed' } },
                { new: true },
            );
            return this.toView(failed || refund);
        }
        const waiting = await Refund.findOneAndUpdate(
            { _id: refund._id, status: 'EXECUTING' },
            {
                $set: {
                    ...common,
                    failure_reason: result.outcome === 'UNKNOWN'
                        ? result.failureReason || 'payout_outcome_unknown'
                        : null,
                },
            },
            { new: true },
        );
        return this.toView(waiting || refund);
    }

    static async instruction(id: string, actor: AuthUser) {
        const refund = await this.manageable(id, actor);
        if (refund.status !== 'EXECUTING') {
            throw refundError('invalid_state', 'Chỉ lấy hướng dẫn khi refund đang EXECUTING');
        }
        if (refund.executor === 'PAYOS_PAYOUT') {
            return {
                executor: refund.executor,
                providerReference: refund.provider_reference,
                payoutId: refund.provider_payout_id,
                status: refund.status,
                failureReason: refund.failure_reason,
                provider: payosPayoutService.status(),
            };
        }
        const dest = refund.destination;
        if (!dest.bank_bin || !dest.account_no) throw refundError('destination_missing', 'Thiếu tài khoản nhận hoàn tiền');
        // Mã đơn dạng VC-<epoch ms>-<4 số> (21 ký tự); bỏ dấu gạch để "HOAN <mã>" vừa 25 ký tự.
        const content = sanitizeTransferContent(`HOAN ${refund.order_code.replace(/[^A-Za-z0-9]/g, '')}`);
        const query = new URLSearchParams({
            amount: String(refund.amount),
            addInfo: content,
            accountName: dest.account_name || '',
        });
        return {
            executor: refund.executor,
            bankBin: dest.bank_bin,
            bankName: dest.bank_name || bankNameOf(dest.bank_bin),
            accountNo: dest.account_no,
            accountName: dest.account_name,
            amount: refund.amount,
            content,
            // Chuỗi EMVCo để FE tự render QR; ảnh img.vietqr.io chỉ là phương án dự phòng.
            qrPayload: buildVietQr(dest.bank_bin, dest.account_no, refund.amount, content),
            qrImageUrl: `https://img.vietqr.io/image/${encodeURIComponent(dest.bank_bin)}-${encodeURIComponent(dest.account_no)}-compact2.png?${query}`,
        };
    }

    /**
     * Poll payout bằng API payOS đã ký. Không gửi thêm lệnh chuyển tiền.
     */
    static async reconcile(id: string, actor: AuthUser) {
        const refund = await this.manageable(id, actor);
        if (refund.executor !== 'PAYOS_PAYOUT' || refund.status !== 'EXECUTING') return this.toView(refund);
        return this.applyPayOSResult(refund, await payosPayoutService.poll(refund));
    }

    static async settle(id: string, actor: AuthUser, evidenceRef: string) {
        const refund = await this.manageable(id, actor);
        if (refund.executor !== 'MANUAL_VIETQR') {
            throw refundError('invalid_executor', 'PayOS payout không được xác nhận thủ công');
        }
        if (refund.status !== 'EXECUTING') {
            throw refundError('invalid_state', `Refund hiện tại là ${refund.status}, không thể settle`);
        }
        const evidence = clean(evidenceRef);
        if (evidence.length < 3 || evidence.length > 300) {
            throw refundError('invalid_evidence', 'Cần mã giao dịch ngân hàng hợp lệ', 400);
        }
        return this.settleInternal(refund, evidence);
    }

    private static async settleInternal(refund: IRefund, evidenceRef: string) {
        const now = new Date();
        // Điều kiện payment_status tránh ghi trùng status_history khi settle chạy lại
        // (webhook và reconcile worker cùng thấy payout SUCCESS).
        await Order.updateOne(
            { _id: refund.order_id, payment_status: { $ne: 'REFUNDED' } },
            {
                $set: { payment_status: 'REFUNDED', order_status: 'CANCELLED', fulfillment_status: 'CANCELLED' },
                $push: {
                    status_history: {
                        status: 'CANCELLED',
                        changed_at: now,
                        note: `Hoàn tiền thành công (${refund.amount.toLocaleString('vi-VN')}₫), mã đối soát: ${evidenceRef}`,
                    },
                },
            },
        );

        try {
            await Transaction.findOneAndUpdate(
                { order_id: refund.order_id, type: 'REFUND', refund_request_id: refund.provider_reference },
                {
                    $setOnInsert: {
                        order_id: refund.order_id,
                        order_code: refund.order_code,
                        user_id: refund.buyer_id,
                        gateway: refund.executor,
                        gateway_transaction_id: evidenceRef,
                        amount: dec(refund.amount),
                        type: 'REFUND',
                        status: 'SUCCESS',
                        refund_request_id: refund.provider_reference,
                        note: `Refund ${refund._id} đã hoàn tất`,
                    },
                },
                { upsert: true, new: true },
            );
        } catch (error: any) {
            // Hai settle đồng thời có thể cùng thấy chưa có transaction trước khi unique
            // index chặn một bên. Bản ghi của bên thắng là kết quả mong muốn.
            if (!duplicateKey(error)) throw error;
            const existing = await Transaction.findOne({
                order_id: refund.order_id,
                type: 'REFUND',
                refund_request_id: refund.provider_reference,
                status: 'SUCCESS',
            });
            if (!existing) throw error;
        }

        await RefundLedgerService.append({
            uniqueKey: `settled:${refund._id}`,
            orderId: refund.order_id,
            refundId: refund._id,
            type: 'REFUND_SETTLED',
            amount: refund.amount,
            reference: evidenceRef,
        });
        await RefundLedgerService.assertInvariant(refund.order_id);

        // Chốt state sau cùng. Mọi side effect phía trên đều idempotent, nên nếu tiến trình
        // chết giữa chừng, settle/reconcile có thể chạy lại mà không trả hoặc ghi tiền hai lần.
        const settled = await Refund.findOneAndUpdate(
            { _id: refund._id, status: 'EXECUTING' },
            {
                $set: {
                    status: 'SETTLED',
                    evidence_ref: evidenceRef,
                    failure_reason: null,
                    closed_at: now,
                },
            },
            { new: true },
        );
        if (!settled) {
            const latest = await Refund.findById(refund._id);
            if (latest?.status === 'SETTLED') return this.toView(latest);
            throw refundError('invalid_state', 'Refund không còn ở trạng thái EXECUTING', 409);
        }
        this.notifyBuyer(settled, 'Hoàn tiền thành công', `Đơn #${settled.order_code} đã được hoàn ${settled.amount.toLocaleString('vi-VN')}₫.`);
        return this.toView(settled);
    }

    static async reject(id: string, actor: AuthUser, note?: string) {
        const refund = await this.manageable(id, actor);
        if (refund.status !== 'REQUESTED') throw refundError('invalid_state', 'Chỉ từ chối refund REQUESTED');
        const rejected = await Refund.findOneAndUpdate(
            { _id: refund._id, status: 'REQUESTED' },
            { $set: { status: 'REJECTED', failure_reason: clean(note).slice(0, 500) || 'merchant_rejected', closed_at: new Date() } },
            { new: true },
        );
        if (!rejected) throw refundError('refund_in_progress', 'Refund đã được tiến trình khác xử lý', 409);
        const order = await Order.findById(rejected.order_id);
        if (order && ['UNFULFILLED', 'QUEUED', 'FAILED'].includes(order.fulfillment_status || 'UNFULFILLED')) {
            dispatchToPrinter(order).catch(error => logger.error(`[REFUND] Không khôi phục được fulfillment: ${error.message}`));
        }
        this.notifyBuyer(rejected, 'Yêu cầu hoàn tiền bị từ chối', `Yêu cầu hoàn tiền cho đơn #${rejected.order_code} đã bị từ chối.`);
        return this.toView(rejected);
    }

    static async retry(id: string, actor: AuthUser) {
        const refund = await this.manageable(id, actor);
        if (refund.status !== 'FAILED') throw refundError('invalid_state', 'Chỉ retry refund FAILED');
        if (refund.executor === 'PAYOS_PAYOUT') {
            let live: PayOSPayoutResult | null;
            try {
                live = await payosPayoutService.findLive(refund);
            } catch (error: any) {
                throw refundError('payout_lookup_failed', `Không kiểm tra được payout cũ: ${error.message}`, 502);
            }
            if (live) {
                const resumed = await Refund.findOneAndUpdate(
                    { _id: refund._id, status: 'FAILED' },
                    {
                        $set: {
                            status: 'EXECUTING',
                            provider_reference: live.referenceId,
                            provider_payout_id: live.payoutId,
                            failure_reason: null,
                        },
                    },
                    { new: true },
                );
                if (!resumed) throw refundError('refund_in_progress', 'Refund đã được tiến trình khác xử lý', 409);
                return this.applyPayOSResult(resumed, live);
            }
        }
        if (refund.attempt_count >= config.refund.maxAttempts) {
            throw refundError('max_attempts_reached', `Đã đạt tối đa ${config.refund.maxAttempts} lần thử`);
        }
        const nextAttempt = refund.attempt_count + 1;
        const reference = refund.executor === 'PAYOS_PAYOUT'
            ? payosPayoutService.referenceFor(refund.order_code, nextAttempt)
            : refund.provider_reference;
        const retried = await Refund.findOneAndUpdate(
            { _id: refund._id, status: 'FAILED', attempt_count: refund.attempt_count },
            {
                $set: {
                    status: 'EXECUTING',
                    provider_reference: reference,
                    provider_payout_id: null,
                    executed_at: new Date(),
                    failure_reason: null,
                },
                $inc: { attempt_count: 1 },
            },
            { new: true },
        );
        if (!retried) throw refundError('refund_in_progress', 'Refund đã được tiến trình khác xử lý', 409);
        return this.runExecutor(retried);
    }

    static async cancel(id: string, actor: AuthUser) {
        const refund = await this.manageable(id, actor);
        if (refund.status !== 'FAILED') throw refundError('invalid_state', 'Chỉ huỷ refund FAILED');
        if (refund.executor === 'PAYOS_PAYOUT') {
            let live: PayOSPayoutResult | null;
            try {
                live = await payosPayoutService.findLive(refund);
            } catch (error: any) {
                throw refundError('payout_lookup_failed', `Không kiểm tra được payout cũ: ${error.message}`, 502);
            }
            if (live?.outcome === 'SUCCESS') {
                const resumed = await Refund.findOneAndUpdate(
                    { _id: refund._id, status: 'FAILED' },
                    {
                        $set: {
                            status: 'EXECUTING',
                            provider_reference: live.referenceId,
                            provider_payout_id: live.payoutId,
                        },
                    },
                    { new: true },
                );
                if (!resumed) throw refundError('refund_in_progress', 'Refund đã được tiến trình khác xử lý', 409);
                return this.applyPayOSResult(resumed, live);
            }
            if (live?.outcome === 'PENDING') {
                throw refundError('payout_in_flight', 'PayOS vẫn đang xử lý payout; không thể huỷ hold');
            }
        }
        const canceled = await Refund.findOneAndUpdate(
            { _id: refund._id, status: 'FAILED' },
            { $set: { status: 'CANCELED', closed_at: new Date() } },
            { new: true },
        );
        if (!canceled) throw refundError('refund_in_progress', 'Refund đã được tiến trình khác xử lý', 409);
        if (canceled.hold_placed) {
            await RefundLedgerService.append({
                uniqueKey: `released:${canceled._id}`,
                orderId: canceled.order_id,
                refundId: canceled._id,
                type: 'REFUND_RELEASED',
                amount: canceled.amount,
                reference: `cancel:${canceled._id}`,
            });
            await RefundLedgerService.assertInvariant(canceled.order_id);
        }
        const order = await Order.findById(canceled.order_id);
        if (order && ['UNFULFILLED', 'QUEUED', 'FAILED'].includes(order.fulfillment_status || 'UNFULFILLED')) {
            dispatchToPrinter(order).catch(error => logger.error(`[REFUND] Không khôi phục được fulfillment: ${error.message}`));
        }
        return this.toView(canceled);
    }

    /** Worker gọi định kỳ; mỗi refund được poll độc lập để một lỗi không chặn cả batch. */
    static async reconcilePendingPayOS(): Promise<void> {
        if (payosPayoutService.activeExecutor() !== 'PAYOS_PAYOUT') return;
        const pending = await Refund.find({
            executor: 'PAYOS_PAYOUT',
            status: 'EXECUTING',
            executed_at: { $lte: new Date(Date.now() - 10_000) },
        }).sort({ executed_at: 1 }).limit(20);

        for (const refund of pending) {
            try {
                await this.reconcileOne(refund);
            } catch (error: any) {
                logger.warn(`[PAYOS PAYOUT] Reconcile refund ${refund._id} lỗi: ${error.message}`);
            }
        }
    }

    private static async reconcileOne(refund: IRefund): Promise<void> {
        const result = await payosPayoutService.poll(refund);
        const timedOut = Boolean(refund.executed_at)
            && Date.now() - refund.executed_at!.getTime() > config.refund.payoutTimeoutSeconds * 1000;
        if (result.outcome === 'SUCCESS' || result.outcome === 'FAILED' || !timedOut) {
            await this.applyPayOSResult(refund, result);
            return;
        }

        const payoutId = result.payoutId || refund.provider_payout_id;
        // payOS xác nhận payout còn đang chạy, hoặc lần hỏi này lỗi nhưng đã biết payoutId:
        // không được FAILED vì nút Retry sẽ tạo payout mới bên cạnh payout có thể vẫn thành công
        // (vd. đang chờ duyệt trên dashboard payOS).
        const inFlight = (result.outcome === 'PENDING' && Boolean(result.payoutId))
            || (result.outcome === 'UNKNOWN' && Boolean(payoutId));
        if (inFlight) {
            logger.error(`[PAYOS PAYOUT] Refund ${refund._id}: payout ${payoutId} vẫn treo từ ${refund.executed_at?.toISOString()}; kiểm tra dashboard payOS.`);
            await Refund.updateOne(
                { _id: refund._id, status: 'EXECUTING' },
                { $set: { failure_reason: 'payout_pending_too_long', provider_payout_id: payoutId } },
            );
            return;
        }
        logger.error(`[PAYOS PAYOUT] Refund ${refund._id} EXECUTING từ ${refund.executed_at?.toISOString()} mà không có payout; đánh FAILED payout_timeout.`);
        await Refund.updateOne(
            { _id: refund._id, status: 'EXECUTING' },
            { $set: { status: 'FAILED', failure_reason: 'payout_timeout' } },
        );
    }

    /**
     * Webhook chỉ là tín hiệu đánh thức. Không tin state trong payload; luôn poll lại payOS
     * bằng credential server trước khi đổi trạng thái tiền.
     */
    static async handlePayOSWebhook(payload: any): Promise<void> {
        const data = payload?.data || payload || {};
        const payoutId = clean(data.id || data.payoutId);
        const referenceId = clean(data.referenceId);
        if ((!payoutId && !referenceId) || payoutId.length > 200 || referenceId.length > 200) return;
        const refund = await Refund.findOne({
            executor: 'PAYOS_PAYOUT',
            status: 'EXECUTING',
            $or: [
                ...(payoutId ? [{ provider_payout_id: payoutId }] : []),
                ...(referenceId ? [{ provider_reference: referenceId }] : []),
            ],
        });
        if (!refund) return;
        await this.applyPayOSResult(refund, await payosPayoutService.poll(refund));
    }

    private static async toView(refund: IRefund) {
        const ledger = await RefundLedgerService.totals(refund.order_id);
        return {
            id: String(refund._id),
            orderId: String(refund.order_id),
            orderCode: refund.order_code,
            buyerId: String(refund.buyer_id),
            shopId: String(refund.shop_id),
            amount: refund.amount,
            paidAmount: refund.paid_amount,
            reason: refund.reason,
            status: refund.status,
            executor: refund.executor,
            destination: refund.destination,
            attemptCount: refund.attempt_count,
            maxAttempts: config.refund.maxAttempts,
            providerReference: refund.provider_reference,
            payoutId: refund.provider_payout_id,
            evidenceRef: refund.evidence_ref,
            failureReason: refund.failure_reason,
            paidAt: refund.paid_at,
            refundableUntil: refund.refundable_until,
            approvalRequired: refund.status === 'REQUESTED',
            provider: payosPayoutService.status(),
            ledger,
            createdAt: refund.created_at,
            updatedAt: refund.updated_at,
            closedAt: refund.closed_at,
        };
    }

    private static notifyBuyer(refund: IRefund, title: string, content: string): void {
        notificationService.createNotification({
            user_id: String(refund.buyer_id),
            type: 'ORDER_UPDATE',
            title,
            content,
            link: `/orders/${refund.order_id}`,
            metadata: { orderId: String(refund.order_id), orderCode: refund.order_code, refundId: String(refund._id) },
        }).catch(error => logger.warn(`[REFUND] Không gửi được thông báo buyer: ${error.message}`));
    }

    private static async notifySeller(refund: IRefund, title: string, content: string): Promise<void> {
        try {
            const shop = await Shop.findById(refund.shop_id).select('owner_id').lean();
            if (!shop?.owner_id) return;
            await notificationService.createNotification({
                user_id: String(shop.owner_id),
                type: 'ORDER_UPDATE',
                title,
                content,
                link: '/seller/orders',
                metadata: { orderId: String(refund.order_id), orderCode: refund.order_code, refundId: String(refund._id) },
            });
        } catch (error: any) {
            logger.warn(`[REFUND] Không gửi được thông báo seller: ${error.message}`);
        }
    }
}
