import mongoose, { Schema, Document } from 'mongoose';

export interface IWebhookLog extends Document {
    provider: string;
    event_type?: string;
    order_id?: mongoose.Types.ObjectId;
    order_code?: string;
    supplier_order_id?: string;
    payload: any;
    headers?: Record<string, any>;
    signature_valid: boolean;
    status: 'SUCCESS' | 'FAILED' | 'INVALID_SIGNATURE';
    error_message?: string;
    ip_address?: string;
    processed_at?: Date;
    created_at: Date;
    updated_at: Date;
}

const WebhookLogSchema = new Schema<IWebhookLog>({
    provider: { type: String, required: true, default: 'PRINTING_SHOP', index: true },
    event_type: { type: String, index: true },
    order_id: { type: Schema.Types.ObjectId, ref: 'Order', index: true },
    order_code: { type: String, index: true },
    supplier_order_id: { type: String, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
    headers: { type: Schema.Types.Mixed },
    signature_valid: { type: Boolean, required: true, default: false },
    status: {
        type: String,
        required: true,
        enum: ['SUCCESS', 'FAILED', 'INVALID_SIGNATURE'],
        default: 'SUCCESS',
        index: true
    },
    error_message: { type: String },
    ip_address: { type: String },
    processed_at: { type: Date }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

WebhookLogSchema.index({ provider: 1, created_at: -1 });

export const WebhookLog = mongoose.model<IWebhookLog>('WebhookLog', WebhookLogSchema, 'webhook_logs');
