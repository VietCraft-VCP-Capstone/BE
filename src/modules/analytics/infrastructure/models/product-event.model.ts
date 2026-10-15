import mongoose, { Schema, Document } from 'mongoose';

export interface IProductEvent extends Document {
    product_id: mongoose.Types.ObjectId;
    session_id: string;
    event_type: 'view' | 'add_to_cart';
    user_id?: mongoose.Types.ObjectId;
    user_agent: string;
    ip_address: string;
    dedupe_key?: string;
    created_at: Date;
}

const ProductEventSchema = new Schema<IProductEvent>({
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    session_id: { type: String, required: true, index: true },
    event_type: { type: String, enum: ['view', 'add_to_cart'], required: true, index: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    user_agent: { type: String, required: true },
    ip_address: { type: String, required: true, index: true },
    dedupe_key: { type: String },
    created_at: { type: Date, default: Date.now, index: true }
}, {
    timestamps: false
});

// Một sự kiện mỗi (phiên, sản phẩm, loại, khung 30 phút); unique để hai request đồng thời không lọt cả hai.
ProductEventSchema.index({ dedupe_key: 1 }, { unique: true, sparse: true });
ProductEventSchema.index({ created_at: 1 }, { expireAfterSeconds: 7776000 }); // TTL: 90 days

export const ProductEvent = mongoose.model<IProductEvent>('ProductEvent', ProductEventSchema, 'product_events');
