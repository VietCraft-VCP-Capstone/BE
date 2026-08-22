import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ITag extends Document {
    name: string;
    slug: string;
    color: string;
    product_count: number;
    status: 'active' | 'pending';
    proposed_by?: mongoose.Types.ObjectId;
    created_at: Date;
    updated_at: Date;
}

const TagSchema = new Schema<ITag>({
    name: { type: String, required: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    color: { type: String, default: '#007700' },
    product_count: { type: Number, default: 0 },
    // Seller-proposed tags land as 'pending' until an admin approves them.
    // ponytail: legacy tags have no status field; queries treat missing as active via {$ne:'pending'}.
    status: { type: String, enum: ['active', 'pending'], default: 'active', index: true },
    proposed_by: { type: Schema.Types.ObjectId, ref: 'User' },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const Tag = mongoose.model<ITag>('Tag', TagSchema, 'tags');
