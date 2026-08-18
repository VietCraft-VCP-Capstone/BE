import mongoose, { Schema, Document } from 'mongoose';

export interface ISearchLog extends Document {
    keyword: string;
    user_id?: mongoose.Types.ObjectId;
    created_at: Date;
}

const SearchLogSchema = new Schema<ISearchLog>({
    keyword: { type: String, required: true, index: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User' }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: false }
});

export const SearchLog = mongoose.model<ISearchLog>('SearchLog', SearchLogSchema, 'search_logs');
