import mongoose, { Schema, Document } from 'mongoose';

export interface IAxis {
    conversion?: number | null;
    rating?: number | null;
    content?: number | null;
    inventory?: number | null;
    freshness?: number | null;
}

export interface ITodo {
    type: string;
    // Thiếu so với §4.3: FE cần `field` để dẫn tới đúng ô trong trình soạn, và
    // `current_value`/`target` để hiện "giá trị hiện tại · mốc" cạnh `message`.
    field?: string;
    message: string;
    current_value?: number | string | null;
    target?: number | string | null;
    impact?: number;
}

export interface IConversionDetail {
    views_30d: number;
    orders_30d: number;
    min_views: number;
    conversion_rate: number | null;
    baseline_rate: number | null;
    baseline_scope: 'category' | 'platform' | null;
    reason: 'not_enough_views' | 'not_enough_peers' | 'no_orders_in_baseline' | null;
}

export interface IListingHealthScore extends Document {
    product_id: mongoose.Types.ObjectId;
    date: Date;
    score: number | null;
    status: 'good' | 'needs_improvement' | 'poor' | null;
    axes: IAxis;
    axes_missing: string[];
    todos: ITodo[];
    content_hash: string;
    content_changed_at?: Date;
    model_version: string;
    computed_at: Date;
    inputs_hash?: string;
    /** Tiến độ và căn cứ của trục tỉ lệ mua: lượt xem/đơn 30 ngày, mặt bằng so sánh, lý do chưa tính. */
    conversion_detail?: IConversionDetail | null;
    created_at: Date;
    updated_at: Date;
}

const AxisSchema = new Schema<IAxis>({
    conversion: { type: Number, default: null },
    rating: { type: Number, default: null },
    content: { type: Number, default: null },
    inventory: { type: Number, default: null },
    freshness: { type: Number, default: null }
}, { _id: false });

const TodoSchema = new Schema<ITodo>({
    type: { type: String, required: true },
    field: { type: String, default: null },
    message: { type: String, required: true },
    current_value: { type: Schema.Types.Mixed, default: null },
    target: { type: Schema.Types.Mixed, default: null },
    impact: { type: Number, default: 0 }
}, { _id: false });

const ListingHealthScoreSchema = new Schema<IListingHealthScore>({
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    date: { type: Date, required: true, index: true },
    score: { type: Number, default: null },
    status: { type: String, enum: ['good', 'needs_improvement', 'poor'], default: null },
    axes: { type: AxisSchema, required: true, default: {} },
    axes_missing: { type: [String], default: [] },
    todos: { type: [TodoSchema], default: [] },
    content_hash: { type: String, required: true },
    content_changed_at: { type: Date, default: null },
    model_version: { type: String, required: true, default: 'health-1.0' },
    computed_at: { type: Date, required: true },
    inputs_hash: { type: String, default: null },
    conversion_detail: { type: Schema.Types.Mixed, default: null }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Composite unique index on product_id and date
ListingHealthScoreSchema.index({ product_id: 1, date: 1 }, { unique: true });

// TTL index for 180 days
ListingHealthScoreSchema.index({ created_at: 1 }, { expireAfterSeconds: 15552000 });

export const ListingHealthScore = mongoose.model<IListingHealthScore>(
    'ListingHealthScore',
    ListingHealthScoreSchema,
    'listing_health_scores'
);
