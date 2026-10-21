import mongoose, { Schema, Document } from 'mongoose';

export interface IRecentSearch extends Document {
    user_id: mongoose.Types.ObjectId;
    keywords: string[];
}

const RecentSearchSchema = new Schema<IRecentSearch>({
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    keywords: [{ type: String }]
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const RecentSearch = mongoose.model<IRecentSearch>('RecentSearch', RecentSearchSchema, 'recent_searches');
