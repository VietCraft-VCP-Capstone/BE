import mongoose, { Schema, Document } from 'mongoose';

export const HEALTH_ACTIONS = ['open', 'apply', 'dismiss'] as const;
export type HealthAction = (typeof HEALTH_ACTIONS)[number];

export interface IHealthActionEvent extends Document {
    product_id: mongoose.Types.ObjectId;
    shop_id: mongoose.Types.ObjectId;
    user_id: mongoose.Types.ObjectId;
    recommendation_id: string;
    kind?: string;
    action: HealthAction;
    created_at: Date;
}

const HealthActionEventSchema = new Schema<IHealthActionEvent>({
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recommendation_id: { type: String, required: true, maxlength: 80 },
    kind: { type: String, maxlength: 20 },
    action: { type: String, enum: [...HEALTH_ACTIONS], required: true },
    created_at: { type: Date, default: Date.now }
}, {
    timestamps: false
});

HealthActionEventSchema.index({ product_id: 1, created_at: -1 });

export const HealthActionEvent = mongoose.model<IHealthActionEvent>('HealthActionEvent', HealthActionEventSchema, 'health_action_events');
