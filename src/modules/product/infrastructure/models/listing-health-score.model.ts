import mongoose, { Schema, Document } from 'mongoose';

export interface IAxis {
    image?: number | null;
    description?: number | null;
    tags?: number | null;
    review?: number | null;
    price?: number | null;
}

export type HealthMethod = 'rule' | 'heuristic' | 'ml_unvalidated' | 'weak_supervision';

export interface ICoverage {
    evaluated: number;
    total: number;
}

export interface IBlocker {
    field: string;
    message: string;
}

export interface IRecommendation {
    id: string;
    kind: 'blocker' | 'search' | 'image' | 'info' | 'price';
    title: string;
    why: string;
    action: string;
    field: string | null;
    effort: number;
    gain_points: number;
    method: HealthMethod;
    evidence: Record<string, unknown>;
}

export interface ITodo {
    type: string;
    field?: string;
    message: string;
    current_value?: number | string | null;
    target?: number | string | null;
    impact?: number;
}

export interface IListingHealthScore extends Document {
    product_id: mongoose.Types.ObjectId;
    date: Date;
    title?: string;
    thumbnail?: string | null;
    score: number | null;
    status: 'good' | 'needs_improvement' | 'poor' | null;
    axes: IAxis;
    axes_missing: string[];
    todos: ITodo[];
    warnings?: ITodo[];
    content_hash: string;
    model_version: string;
    computed_at: Date;
    inputs_hash?: string;
    coverage?: ICoverage | null;
    factors?: Record<string, unknown>[];
    blockers?: IBlocker[];
    recommendations?: IRecommendation[];
    search?: Record<string, unknown> | null;
    versions?: Record<string, unknown> | null;
    content_snapshot?: Record<string, unknown> | null;
    created_at: Date;
    updated_at: Date;
}

const AxisSchema = new Schema<IAxis>({
    image: { type: Number, default: null },
    description: { type: Number, default: null },
    tags: { type: Number, default: null },
    review: { type: Number, default: null },
    price: { type: Number, default: null }
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
    title: { type: String, default: null },
    thumbnail: { type: String, default: null },
    score: { type: Number, default: null },
    status: { type: String, enum: ['good', 'needs_improvement', 'poor'], default: null },
    axes: { type: AxisSchema, required: true, default: {} },
    axes_missing: { type: [String], default: [] },
    todos: { type: [TodoSchema], default: [] },
    warnings: { type: [Schema.Types.Mixed], default: [] },
    content_hash: { type: String, required: true },
    model_version: { type: String, required: true, default: 'health-3.0' },
    computed_at: { type: Date, required: true },
    inputs_hash: { type: String, default: null },
    coverage: { type: Schema.Types.Mixed, default: null },
    factors: { type: [Schema.Types.Mixed], default: [] },
    blockers: { type: [Schema.Types.Mixed], default: [] },
    recommendations: { type: [Schema.Types.Mixed], default: [] },
    search: { type: Schema.Types.Mixed, default: null },
    versions: { type: Schema.Types.Mixed, default: null },
    content_snapshot: { type: Schema.Types.Mixed, default: null }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

ListingHealthScoreSchema.index({ product_id: 1, date: 1 }, { unique: true });

ListingHealthScoreSchema.index({ created_at: 1 }, { expireAfterSeconds: 15552000 });

export const ListingHealthScore = mongoose.model<IListingHealthScore>(
    'ListingHealthScore',
    ListingHealthScoreSchema,
    'listing_health_scores'
);
