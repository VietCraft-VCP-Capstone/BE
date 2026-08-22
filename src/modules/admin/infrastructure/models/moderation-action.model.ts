import mongoose, { Schema, Document } from 'mongoose';

export interface IModerationAction extends Document {
    product_id: mongoose.Types.ObjectId;
    reviewer_id: mongoose.Types.ObjectId;
    action: 'approve' | 'reject' | 'unpublish' | 'republish';
    notes?: string;
    rejection_reason?: string;
    created_at: Date;
}

const ModerationActionSchema = new Schema<IModerationAction>({
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    reviewer_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: { type: String, required: true, enum: ['approve', 'reject', 'unpublish', 'republish'] },
    notes: { type: String },
    rejection_reason: { type: String },
}, {
    timestamps: { createdAt: 'created_at' }
});

export const ModerationAction = mongoose.model<IModerationAction>('ModerationAction', ModerationActionSchema, 'moderation_actions');
