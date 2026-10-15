import mongoose, { Schema, Document } from 'mongoose';

export interface IProductEvent extends Document {
    product_id: mongoose.Types.ObjectId;
    session_id: string;
    event_type: 'view' | 'add_to_cart';
    user_id?: mongoose.Types.ObjectId;
    user_agent: string;
    ip_address: string;
    created_at: Date;
}

const ProductEventSchema = new Schema<IProductEvent>({
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    session_id: { type: String, required: true, index: true },
    event_type: { type: String, enum: ['view', 'add_to_cart'], required: true, index: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    user_agent: { type: String, required: true },
    ip_address: { type: String, required: true, index: true },
    created_at: { type: Date, default: Date.now, index: true }
}, {
    timestamps: false
});

// Unique index for deduplication: (session_id, product_id, event_type, 30-min window)
// We'll use a compound index on session_id, product_id, and event_type
// The 30-min window deduplication will be handled in the service layer
ProductEventSchema.index({ session_id: 1, product_id: 1, event_type: 1, created_at: -1 });
ProductEventSchema.index({ created_at: 1 }, { expireAfterSeconds: 7776000 }); // TTL: 90 days

export const ProductEvent = mongoose.model<IProductEvent>('ProductEvent', ProductEventSchema, 'product_events');
