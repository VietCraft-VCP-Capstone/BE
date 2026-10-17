import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICategory extends Document {
    name: string;
    slug: string;
    description?: string;
    parent_id?: mongoose.Types.ObjectId;
    icon: string;
    sort_order: number;
    is_active: boolean;
    status: 'active' | 'pending' | 'banned';
    review_status?: 'pending' | 'approved' | 'rejected' | 'banned';
    proposed_by?: mongoose.Types.ObjectId;
    rejected_at?: Date | null;
    rejected_by?: mongoose.Types.ObjectId | null;
    reject_reason?: string | null;
    created_at: Date;
    updated_at: Date;
}

const CategorySchema = new Schema<ICategory>({
    name: { type: String, required: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String },
    parent_id: { type: Schema.Types.ObjectId, ref: 'Category', index: true },
    icon: { type: String, default: 'tag' },
    sort_order: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
    status: { type: String, enum: ['active', 'pending', 'banned'], default: 'active', index: true },
    review_status: { type: String, enum: ['pending', 'approved', 'rejected', 'banned'], default: 'approved', index: true },
    proposed_by: { type: Schema.Types.ObjectId, ref: 'User' },
    rejected_at: { type: Date, default: null },
    rejected_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reject_reason: { type: String, default: null },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const Category = mongoose.model<ICategory>('Category', CategorySchema, 'categories');
