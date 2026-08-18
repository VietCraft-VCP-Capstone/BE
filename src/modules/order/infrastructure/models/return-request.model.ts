import mongoose, { Schema, Document } from 'mongoose';

export interface IReturnRequest extends Document {
    order_id: mongoose.Types.ObjectId;
    buyer_id: mongoose.Types.ObjectId;
    reason: string;
    evidence_images: string[];
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISPUTED';
    dispute_note_admin?: string;
    created_at: Date;
    updated_at: Date;
}

const ReturnRequestSchema = new Schema<IReturnRequest>({
    order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    buyer_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true },
    evidence_images: { type: [String], default: [] },
    status: {
        type: String,
        required: true,
        enum: ['PENDING', 'APPROVED', 'REJECTED', 'DISPUTED'],
        default: 'PENDING'
    },
    dispute_note_admin: { type: String }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const ReturnRequest = mongoose.model<IReturnRequest>('ReturnRequest', ReturnRequestSchema, 'return_requests');
