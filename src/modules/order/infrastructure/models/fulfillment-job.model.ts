import mongoose, { Schema, Document } from 'mongoose';

export interface IFulfillmentErrorRecord {
    attempt: number;
    error: string;
    timestamp: Date;
}

export interface IFulfillmentJob extends Document {
    order_id: mongoose.Types.ObjectId;
    order_code: string;
    action: 'DISPATCH_ORDER' | 'CANCEL_ORDER';
    payload: any;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    attempts: number;
    max_attempts: number;
    next_run_at: Date;
    last_error?: string;
    error_history: IFulfillmentErrorRecord[];
    created_at: Date;
    updated_at: Date;
}

const FulfillmentJobSchema = new Schema<IFulfillmentJob>({
    order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    order_code: { type: String, required: true, index: true },
    action: { type: String, required: true, default: 'DISPATCH_ORDER' },
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
        type: String,
        required: true,
        enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
        default: 'PENDING',
        index: true
    },
    attempts: { type: Number, required: true, default: 0 },
    max_attempts: { type: Number, required: true, default: 4 },
    next_run_at: { type: Date, required: true, default: Date.now, index: true },
    last_error: { type: String },
    error_history: [{
        attempt: { type: Number, required: true },
        error: { type: String, required: true },
        timestamp: { type: Date, default: Date.now }
    }]
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

FulfillmentJobSchema.index({ status: 1, next_run_at: 1 });

export const FulfillmentJob = mongoose.model<IFulfillmentJob>('FulfillmentJob', FulfillmentJobSchema, 'fulfillment_jobs');
