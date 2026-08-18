import mongoose, { Schema, Document } from 'mongoose';

export interface IBreakdown {
    image_count_score: number;
    description_length_score: number;
    tag_count_score: number;
    review_ratio_score: number;
    price_competitiveness_score: number;
}

export interface IListingHealthScore extends Document {
    product_id: mongoose.Types.ObjectId;
    score: number;
    breakdown: IBreakdown;
    todo_list: string[];
    created_at: Date;
    updated_at: Date;
}

const BreakdownSchema = new Schema<IBreakdown>({
    image_count_score: { type: Number, required: true },
    description_length_score: { type: Number, required: true },
    tag_count_score: { type: Number, required: true },
    review_ratio_score: { type: Number, required: true },
    price_competitiveness_score: { type: Number, required: true }
}, { _id: false });

const ListingHealthScoreSchema = new Schema<IListingHealthScore>({
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true, unique: true, index: true },
    score: { type: Number, required: true },
    breakdown: { type: BreakdownSchema, required: true },
    todo_list: { type: [String], default: [] }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const ListingHealthScore = mongoose.model<IListingHealthScore>('ListingHealthScore', ListingHealthScoreSchema, 'listing_health_scores');
