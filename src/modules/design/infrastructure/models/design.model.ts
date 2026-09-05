import mongoose, { Schema, Document } from 'mongoose';

export interface IDesign extends Document {
    seller_id: mongoose.Types.ObjectId;
    name: string;
    file_url: string;
    storage: 'local' | 'cloudinary';
    public_id?: string;
    width_px: number;
    height_px: number;
    created_at: Date;
    updated_at: Date;
}

const DesignSchema = new Schema<IDesign>({
    seller_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    file_url: { type: String, required: true },
    storage: { type: String, enum: ['local', 'cloudinary'], default: 'local' },
    public_id: { type: String },
    width_px: { type: Number, required: true },
    height_px: { type: Number, required: true },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const Design = mongoose.model<IDesign>('Design', DesignSchema, 'product_designs');
export default Design;
