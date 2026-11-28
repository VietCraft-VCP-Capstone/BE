import mongoose, { Schema, Document } from 'mongoose';

/** Kế hoạch mùa vụ của một shop cho một kỳ dịp (dịp + năm của ngày lễ). */
export interface ISeasonalPlan extends Document {
    shop_id: mongoose.Types.ObjectId;
    event_key: string;
    event_year: number;
    saved_ideas: string[];
    idea_drafts: Record<string, any>;
    /** nội dung ý tưởng lúc seller lưu (danh sách ý tưởng đổi hằng ngày theo dữ liệu thị trường) */
    idea_snapshots: Record<string, any>;
    checked_milestones: Record<string, boolean>;
    review?: { rating: 'good' | 'neutral' | 'poor'; note: string; updated_at: Date } | null;
    /** đánh giá riêng từng ý tưởng đã áp dụng: { [idea_id (đã thay ".")]: { rating, note, updated_at } } */
    idea_reviews?: Record<string, { rating: 'good' | 'neutral' | 'poor'; note: string; updated_at: Date }>;
    /** mốc thời gian của kỳ (ISO date) để nhắc việc; cập nhật mỗi khi seller mở trang */
    milestones?: { event_name?: string; traction_start?: string; cut_off_date?: string; event_date?: string; post_event_end?: string };
    /** mốc đã nhắc: { traction_start | cutoff_soon | post_event: ISO time } */
    reminded?: Record<string, string>;
    created_at: Date;
    updated_at: Date;
}

const SeasonalPlanSchema = new Schema<ISeasonalPlan>({
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    event_key: { type: String, required: true, maxlength: 40 },
    event_year: { type: Number, required: true, min: 2020, max: 2100 },
    saved_ideas: { type: [String], default: [] },
    idea_drafts: { type: Schema.Types.Mixed, default: {} },
    idea_snapshots: { type: Schema.Types.Mixed, default: {} },
    checked_milestones: { type: Schema.Types.Mixed, default: {} },
    review: {
        type: new Schema({
            rating: { type: String, enum: ['good', 'neutral', 'poor'], required: true },
            note: { type: String, default: '', maxlength: 1000 },
            updated_at: { type: Date, default: Date.now },
        }, { _id: false }),
        default: null,
    },
    idea_reviews: { type: Schema.Types.Mixed, default: {} },
    milestones: { type: Schema.Types.Mixed, default: undefined },
    reminded: { type: Schema.Types.Mixed, default: {} },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    minimize: false,
});

SeasonalPlanSchema.index({ shop_id: 1, event_key: 1, event_year: 1 }, { unique: true });
SeasonalPlanSchema.index({ shop_id: 1, event_year: 1 });
SeasonalPlanSchema.index({ 'milestones.post_event_end': 1 });

export const SeasonalPlan = mongoose.model<ISeasonalPlan>('SeasonalPlan', SeasonalPlanSchema, 'seasonal_plans');
