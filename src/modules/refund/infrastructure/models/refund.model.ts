import mongoose, { Document, Schema } from 'mongoose';
import { REFUND_STATUSES, RefundExecutor, RefundStatus } from '../../domain/refund-state';

export interface IRefundDestination {
    bank_bin?: string;
    bank_name?: string;
    account_no?: string;
    account_name?: string;
}

export interface IRefund extends Document {
    order_id: mongoose.Types.ObjectId;
    order_code: string;
    buyer_id: mongoose.Types.ObjectId;
    shop_id: mongoose.Types.ObjectId;
    amount: number;
    /** Số tiền thực nhận dùng làm vế trái của ledger invariant. */
    paid_amount: number;
    reason: string;
    status: RefundStatus;
    executor: RefundExecutor;
    destination: IRefundDestination;
    idempotency_key: string;
    request_hash: string;
    attempt_count: number;
    hold_placed: boolean;
    provider_reference?: string;
    provider_payout_id?: string;
    evidence_ref?: string;
    failure_reason?: string;
    paid_at: Date;
    refundable_until: Date;
    requested_by: mongoose.Types.ObjectId;
    approved_by?: mongoose.Types.ObjectId;
    approved_at?: Date;
    executed_at?: Date;
    closed_at?: Date;
    created_at: Date;
    updated_at: Date;
}

const DestinationSchema = new Schema<IRefundDestination>({
    bank_bin: { type: String, trim: true },
    bank_name: { type: String, trim: true },
    account_no: { type: String, trim: true },
    account_name: { type: String, trim: true },
}, { _id: false });

const RefundSchema = new Schema<IRefund>({
    order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true, index: true },
    order_code: { type: String, required: true, index: true },
    buyer_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    paid_amount: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: REFUND_STATUSES, default: 'REQUESTED', required: true, index: true },
    executor: { type: String, enum: ['PAYOS_PAYOUT', 'MANUAL_VIETQR'], required: true },
    destination: { type: DestinationSchema, default: () => ({}) },
    idempotency_key: { type: String, required: true, unique: true, index: true, maxlength: 200 },
    request_hash: { type: String, required: true, maxlength: 64 },
    attempt_count: { type: Number, default: 0, min: 0 },
    hold_placed: { type: Boolean, default: false },
    provider_reference: { type: String, index: true },
    provider_payout_id: { type: String, index: true },
    evidence_ref: { type: String, trim: true, maxlength: 300 },
    failure_reason: { type: String, maxlength: 500 },
    paid_at: { type: Date, required: true },
    refundable_until: { type: Date, required: true, index: true },
    requested_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approved_by: { type: Schema.Types.ObjectId, ref: 'User' },
    approved_at: { type: Date },
    executed_at: { type: Date },
    closed_at: { type: Date },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

RefundSchema.index({ shop_id: 1, created_at: -1 });
RefundSchema.index({ buyer_id: 1, created_at: -1 });

export const Refund = mongoose.model<IRefund>('Refund', RefundSchema, 'refunds');
