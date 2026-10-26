import mongoose, { Schema, Document } from 'mongoose';

export interface ITag extends Document {
    name: string;
    slug: string;
    color: string;
    product_count: number;
    status: 'active' | 'pending' | 'banned';
    review_status?: 'pending' | 'approved' | 'rejected' | 'banned';
    proposed_by?: mongoose.Types.ObjectId;
    rejected_at?: Date | null;
    rejected_by?: mongoose.Types.ObjectId | null;
    reject_reason?: string | null;
    created_at: Date;
    updated_at: Date;
}

const TagSchema = new Schema<ITag>({
    name: { type: String, required: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    color: { type: String, default: '#007700' },
    product_count: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'pending', 'banned'], default: 'active', index: true },
    review_status: { type: String, enum: ['pending', 'approved', 'rejected', 'banned'], default: 'approved', index: true },
    proposed_by: { type: Schema.Types.ObjectId, ref: 'User' },
    rejected_at: { type: Date, default: null },
    rejected_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reject_reason: { type: String, default: null },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const Tag = mongoose.model<ITag>('Tag', TagSchema, 'tags');

