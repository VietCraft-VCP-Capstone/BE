import crypto from 'crypto';
import mongoose from 'mongoose';
import { PaymentRefundExecution, type PaymentRefundRecord, type PaymentRefundStatus } from './refund-execution.model';
import { Order } from '../../order/infrastructure/models/order.model';
import { Transaction } from '../../order/infrastructure/models/transaction.model';
import { byCodeOrId, num, dec } from '../../order/utils';
import { formatVnpayDate } from '../utils/vnpay.util';
import { payosService } from '../application/payos.service';
import { RefundExecutionError, type RefundContext, type RefundExecutionInput, type RefundExecutionRepository, type RefundGatewayResult } from '../application/refund-execution.service';

export class MongoRefundExecutionRepository implements RefundExecutionRepository {
    async loadContext(orderId: string): Promise<RefundContext> {
        const order = await Order.findOne(byCodeOrId(orderId)).lean();
        if (!order) throw new RefundExecutionError('Không tìm thấy đơn hàng.', 404);
        const tx = await Transaction.findOne({ order_id: order._id, gateway: order.payment_method, type: 'PAYMENT', status: 'SUCCESS' }).sort({ created_at: -1 }).lean();
        const total = Math.max(0, num(order.financial_breakdown.subtotal) + num(order.financial_breakdown.shipping_fee) - num(order.financial_breakdown.coupon_discount));
        return {
            orderId: String(order._id), orderCode: order.order_code, buyerId: String(order.buyer_id),
            paymentMethod: order.payment_method, paymentStatus: order.payment_status,
            simulated: order.is_simulated === true || /^TEST-/.test(order.order_code),
            paidAmount: tx ? Math.min(total, num(tx.amount)) : total,
            originalTransactionId: tx?.gateway_transaction_id || '',
            transactionDate: tx?.callback_payload?.vnp_CreateDate || tx?.callback_payload?.vnp_PayDate || formatVnpayDate(tx?.created_at),
            ...(order.payment_method === 'PAYOS' ? { destination: await payosService.resolveRefundDestination(order, tx) } : {}),
        };
    }
    async findOrCreate(input: RefundExecutionInput): Promise<PaymentRefundRecord> {
        const existing = await PaymentRefundExecution.findOne({ business_key: input.businessKey }).lean();
        if (existing) return existing;
        try {
            return (await PaymentRefundExecution.create({ _id: crypto.randomUUID(), business_key: input.businessKey, order_id: input.orderId, amount: input.amount, status: 'READY', gateway_request_id: crypto.randomBytes(16).toString('hex') })).toObject();
        } catch (error) {
            if ((error as { code?: number }).code !== 11000) throw error;
            const raced = await PaymentRefundExecution.findOne({ business_key: input.businessKey }).lean();
            if (!raced) throw error; return raced;
        }
    }
    async claim(record: PaymentRefundRecord): Promise<boolean> {
        const requestId = record.status === 'FAILED' ? crypto.randomBytes(16).toString('hex') : record.gateway_request_id;
        const updated = await PaymentRefundExecution.findOneAndUpdate({ _id: record._id, status: { $in: ['READY', 'FAILED'] } }, { $set: { status: 'PROCESSING', gateway_request_id: requestId }, $unset: { error: 1, gateway_response: 1 } }, { new: true }).lean();
        if (updated) Object.assign(record, updated);
        return !!updated;
    }
    async lockOrder(orderId: string, executionId: string): Promise<boolean> {
        const changed = await Order.updateOne({ _id: orderId, $or: [{ refund_execution_id: { $exists: false } }, { refund_execution_id: null }, { refund_execution_id: executionId }] }, { $set: { refund_execution_id: executionId } });
        return changed.matchedCount === 1;
    }
    async refundedAmount(orderId: string): Promise<number> {
        const rows = await Transaction.aggregate([{ $match: { order_id: new mongoose.Types.ObjectId(orderId), type: 'REFUND', status: 'SUCCESS' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
        return rows.length ? Number(String(rows[0].total)) : 0;
    }
    async recordResult(id: string, status: PaymentRefundStatus, result: Partial<RefundGatewayResult>): Promise<void> {
        await PaymentRefundExecution.updateOne({ _id: id, status: { $ne: 'SUCCEEDED' } }, { $set: { status, ...(result.data ? { gateway_response: result.data } : {}), ...(result.request ? { gateway_request: result.request } : {}), error: result.error || null } });
    }
    async releaseOrder(orderId: string, executionId: string): Promise<void> {
        await Order.updateOne({ _id: orderId, refund_execution_id: executionId }, { $unset: { refund_execution_id: 1 } });
    }
    async materializeSuccess(context: RefundContext, record: PaymentRefundRecord): Promise<void> {
        await Transaction.updateOne({ refund_execution_id: record._id }, { $setOnInsert: {
            order_id: context.orderId, order_code: context.orderCode, user_id: context.buyerId,
            gateway: context.paymentMethod, gateway_transaction_id: record.gateway_response?.vnp_TransactionNo || record.gateway_response?.reference || record.gateway_response?.payoutId,
            gateway_response_code: '00', amount: dec(record.amount), type: 'REFUND', status: 'SUCCESS',
            refund_request_id: record.business_key, refund_execution_id: record._id,
            callback_payload: record.gateway_response || {}, note: `${context.paymentMethod === 'PAYOS' ? 'payOS' : 'VNPay'} xác nhận hoàn ${record.amount}đ cho đơn ${context.orderCode}.`,
        } }, { upsert: true, runValidators: true });
        const refunded = await this.refundedAmount(context.orderId);
        await Order.updateOne({ _id: context.orderId }, { $set: { refund_status: 'REFUNDED', ...(refunded >= context.paidAmount ? { payment_status: 'REFUNDED' } : {}) } });
        // Delivery/order status is unchanged for both full and partial refunds.
        await this.releaseOrder(context.orderId, record._id);
    }
}
