import mongoose, { Schema, Document } from 'mongoose';

export interface IBannedKeyword extends Document {
    keyword: string;
    reason?: string;
    created_by: mongoose.Types.ObjectId;
}

const BannedKeywordSchema = new Schema<IBannedKeyword>({
    keyword: { type: String, required: true, unique: true, index: true },
    reason: { type: String },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const BannedKeyword = mongoose.model<IBannedKeyword>('BannedKeyword', BannedKeywordSchema, 'banned_keywords');
