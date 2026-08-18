import mongoose, { Schema, Document } from 'mongoose';

export interface IReview extends Document {
    product_id: mongoose.Types.ObjectId;
    buyer_id: mongoose.Types.ObjectId;
    order_id: mongoose.Types.ObjectId;
    rating: number;
    comment?: string;
    images: string[];
    seller_response?: string;
    replied_at?: Date;
    is_reported: boolean;
    created_at: Date;
}

const ReviewSchema = new Schema<IReview>({
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    buyer_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String },
    images: { type: [String], default: [] },
    seller_response: { type: String },
    replied_at: { type: Date },
    is_reported: { type: Boolean, default: false }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: false }
});

export const Review = mongoose.model<IReview>('Review', ReviewSchema, 'reviews');
