import mongoose, { Schema, Document, Model } from 'mongoose';
import { normalizeVi } from '../../../../shared/utils/vietnamese-search.util';

export interface ICategory extends Document {
    name: string;
    name_norm?: string;
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
    name_norm: { type: String, index: true },
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

CategorySchema.pre('save', function (next) {
    if (this.isModified('name') || !this.name_norm) {
        this.name_norm = normalizeVi(this.name || '');
    }
    next();
});

CategorySchema.index({ name_norm: 1 });

export const Category = mongoose.model<ICategory>('Category', CategorySchema, 'categories');
