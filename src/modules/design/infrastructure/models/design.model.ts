import mongoose, { Schema, Document } from 'mongoose';

// Thiết kế (artwork) do seller upload, dùng để đè lên phôi khi tạo SP POD.
export interface IDesign extends Document {
    seller_id: mongoose.Types.ObjectId;
    name: string;
    file_url: string;
    /** Nơi file thật sự nằm. 'local' = BE/uploads, 'cloudinary' = CDN. */
    storage: 'local' | 'cloudinary';
    /** Định danh asset trên Cloudinary (chỉ có khi storage='cloudinary'). */
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
    // Bản ghi cũ không có field này -> mặc định 'local', đúng với nơi chúng đang nằm.
    storage: { type: String, enum: ['local', 'cloudinary'], default: 'local' },
    public_id: { type: String },
    width_px: { type: Number, required: true },
    height_px: { type: Number, required: true },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const Design = mongoose.model<IDesign>('Design', DesignSchema, 'product_designs');
export default Design;
