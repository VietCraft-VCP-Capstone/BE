import mongoose, { Schema } from 'mongoose';

export type PaymentRefundStatus = 'READY' | 'PROCESSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED';
export interface PaymentRefundRecord {
    _id: string; business_key: string; order_id: string; amount: number; status: PaymentRefundStatus;
    gateway_request_id: string; gateway_response?: Record<string, any>; gateway_request?: Record<string, any>;
    error?: string; created_at: Date; updated_at: Date;
}

const schema = new Schema<PaymentRefundRecord>({
    _id: { type: String, required: true },
    business_key: { type: String, required: true, unique: true },
    order_id: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    status: { type: String, required: true, enum: ['READY', 'PROCESSING', 'PENDING', 'SUCCEEDED', 'FAILED'] },
    gateway_request_id: { type: String, required: true },
    gateway_request: Schema.Types.Mixed, gateway_response: Schema.Types.Mixed, error: String,
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export const PaymentRefundExecution = mongoose.model<PaymentRefundRecord>('PaymentRefundExecution', schema, 'payment_refund_executions');
