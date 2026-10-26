import mongoose, { Schema, Document } from 'mongoose';

export interface ISearchClick {
    product_id: mongoose.Types.ObjectId;
    position: number;
    clicked_at: Date;
}

export interface ISearchLog extends Document {
    keyword: string;
    user_id?: mongoose.Types.ObjectId;
    result_count?: number;
    clicks?: ISearchClick[];
    created_at: Date;
}

const SearchClickSchema = new Schema<ISearchClick>({
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    position: { type: Number, required: true },
    clicked_at: { type: Date, default: Date.now }
}, { _id: false });

const SearchLogSchema = new Schema<ISearchLog>({
    keyword: { type: String, required: true, index: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User' },
    result_count: { type: Number },
    clicks: { type: [SearchClickSchema], default: undefined }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: false }
});


export const SearchLog = mongoose.model<ISearchLog>('SearchLog', SearchLogSchema, 'search_logs');
