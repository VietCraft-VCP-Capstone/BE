import mongoose, { Schema, Document } from 'mongoose';

/** Bản dự báo "nếu bán như ngày thường" của một kỳ dịp, mỗi tuần một bản (để đối chiếu sau lễ). */
export interface ISeasonalForecastLog extends Document {
    shop_id: mongoose.Types.ObjectId;
    event_key: string;
    event_year: number;
    iso_week: string;
    made_at: Date;
    days_to_event: number;
    window_start: Date;
    window_end: Date;
    baseline_daily_rate: number;
    baseline_orders: number;
    baseline_days: number;
    window_days: number;
    expected: { p10: number; p50: number; p90: number };
    search_uplift: number | null;
    method: string;
}

const SeasonalForecastLogSchema = new Schema<ISeasonalForecastLog>({
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    event_key: { type: String, required: true, maxlength: 40 },
    event_year: { type: Number, required: true },
    iso_week: { type: String, required: true, maxlength: 10 },
    made_at: { type: Date, required: true },
    days_to_event: { type: Number, required: true },
    window_start: { type: Date, required: true },
    window_end: { type: Date, required: true },
    baseline_daily_rate: { type: Number, required: true },
    baseline_orders: { type: Number, required: true },
    baseline_days: { type: Number, required: true },
    window_days: { type: Number, required: true },
    expected: {
        p10: { type: Number, required: true },
        p50: { type: Number, required: true },
        p90: { type: Number, required: true },
    },
    search_uplift: { type: Number, default: null },
    method: { type: String, default: 'normal_day_poisson_v1' },
}, { timestamps: false });

SeasonalForecastLogSchema.index({ shop_id: 1, event_key: 1, event_year: 1, iso_week: 1 }, { unique: true });

export const SeasonalForecastLog = mongoose.model<ISeasonalForecastLog>(
    'SeasonalForecastLog',
    SeasonalForecastLogSchema,
    'seasonal_forecast_logs',
);
