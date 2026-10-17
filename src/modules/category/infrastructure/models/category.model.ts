import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICategory extends Document {
    name: string;
    slug: string;
    description?: string;
    parent_id?: mongoose.Types.ObjectId;
    icon: string;
    sort_order: number;
    is_active: boolean;
    status: 'active' | 'pending';
    proposed_by?: mongoose.Types.ObjectId;
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
    status: { type: String, enum: ['active', 'pending'], default: 'active', index: true },
    proposed_by: { type: Schema.Types.ObjectId, ref: 'User' },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const Category = mongoose.model<ICategory>('Category', CategorySchema, 'categories');
