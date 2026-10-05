import mongoose, { Document, Schema } from 'mongoose';

export const RETURN_REFUND_EXECUTION_STATUS = 'PENDING_INTEGRATION' as const;
export type ReturnRefundExecutionStatus = typeof RETURN_REFUND_EXECUTION_STATUS | 'REFUNDED' | 'COMPLETED';
export type ReturnFaultParty = 'BUYER' | 'SELLER' | 'PRINTER' | 'CARRIER' | 'PLATFORM';

export interface IReturnRefundExecution extends Document {
    request_id: string;
    order_item_id: string;
    order_id: string;
    resolution: 'REFUND';
    fault_party: ReturnFaultParty;
    amount_minor: number;
    currency: string;
    admin_decision_id: string;
    status: ReturnRefundExecutionStatus;
    created_at: Date;
    updated_at: Date;
}

const ReturnRefundExecutionSchema = new Schema<IReturnRefundExecution>({
    request_id: { type: String, required: true, trim: true },
    order_item_id: { type: String, required: true, trim: true },
    order_id: { type: String, required: true, trim: true },
    resolution: { type: String, enum: ['REFUND'], required: true },
    fault_party: { type: String, enum: ['BUYER', 'SELLER', 'PRINTER', 'CARRIER', 'PLATFORM'], required: true },
    amount_minor: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, trim: true, uppercase: true, minlength: 3, maxlength: 3 },
    admin_decision_id: { type: String, required: true, trim: true },
    status: { type: String, enum: [RETURN_REFUND_EXECUTION_STATUS, 'REFUNDED', 'COMPLETED'], required: true, default: RETURN_REFUND_EXECUTION_STATUS },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, versionKey: false });

ReturnRefundExecutionSchema.index({ request_id: 1, order_item_id: 1 }, { unique: true, name: 'uniq_return_refund_request_item' });

export const ReturnRefundExecution = mongoose.model<IReturnRefundExecution>(
    'ReturnRefundExecution', ReturnRefundExecutionSchema, 'return_refund_executions',
);
