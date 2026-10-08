import mongoose, { Schema, Document } from 'mongoose';

export interface ITransaction extends Document {
    order_id?: mongoose.Types.ObjectId;
    order_code?: string;
    user_id: mongoose.Types.ObjectId;
    gateway?: string;
    gateway_transaction_id?: string;
    gateway_bank_code?: string;
    gateway_response_code?: string;
    amount: mongoose.Types.Decimal128;
    type: 'PAYMENT' | 'REFUND' | 'PAYOUT' | 'LISTING_FEE' | 'TRANSACTION_FEE';
    status: 'SUCCESS' | 'FAILED' | 'PENDING';
    callback_payload?: Record<string, any>;
    refund_request_id?: string;
    payment_date?: Date;
    refund_execution_id?: string;
    note?: string;
    created_at: Date;
}

const TransactionSchema = new Schema<ITransaction>({
    order_id: { type: Schema.Types.ObjectId, ref: 'Order', index: true },
    order_code: { type: String, index: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    gateway: { type: String, default: 'VNPAY' },
    gateway_transaction_id: { type: String, index: true },
    gateway_bank_code: { type: String },
    gateway_response_code: { type: String },
    amount: { type: Schema.Types.Decimal128, required: true },
    type: {
        type: String,
        required: true,
        enum: ['PAYMENT', 'REFUND', 'PAYOUT', 'LISTING_FEE', 'TRANSACTION_FEE']
    },
    status: {
        type: String,
        required: true,
        enum: ['SUCCESS', 'FAILED', 'PENDING'],
        default: 'PENDING'
    },
    callback_payload: { type: Schema.Types.Mixed, default: {} },
    refund_request_id: { type: String, index: true },
    payment_date: { type: Date },
    refund_execution_id: { type: String },
    note: { type: String }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: false }
});

TransactionSchema.index({ refund_execution_id: 1 }, { unique: true, partialFilterExpression: { refund_execution_id: { $type: 'string' } } });
export const Transaction = mongoose.model<ITransaction>('Transaction', TransactionSchema, 'transactions');
