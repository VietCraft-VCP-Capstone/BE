import mongoose, { Schema, Document } from 'mongoose';

export interface ICompetitorTracker extends Document {
    seller_user_id: mongoose.Types.ObjectId;
    tracked_shop_ids: mongoose.Types.ObjectId[];
}

const CompetitorTrackerSchema = new Schema<ICompetitorTracker>({
    seller_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    tracked_shop_ids: [{ type: Schema.Types.ObjectId, ref: 'Shop', default: [] }]
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const CompetitorTracker = mongoose.model<ICompetitorTracker>('CompetitorTracker', CompetitorTrackerSchema, 'competitor_trackers');
