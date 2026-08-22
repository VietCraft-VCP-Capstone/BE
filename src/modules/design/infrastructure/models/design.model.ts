import mongoose, { Schema, Document } from 'mongoose';

// Thiết kế (artwork) do seller upload, dùng để đè lên phôi khi tạo SP POD.
export interface IDesign extends Document {
    seller_id: mongoose.Types.ObjectId;
    name: string;
    file_url: string;
    width_px: number;
    height_px: number;
    created_at: Date;
    updated_at: Date;
}

const DesignSchema = new Schema<IDesign>({
    seller_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    file_url: { type: String, required: true },
    width_px: { type: Number, required: true },
    height_px: { type: Number, required: true },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const Design = mongoose.model<IDesign>('Design', DesignSchema, 'product_designs');
export default Design;
