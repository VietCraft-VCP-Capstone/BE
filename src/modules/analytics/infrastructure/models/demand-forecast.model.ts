import mongoose, { Schema, Document } from 'mongoose';

export interface IDemandForecast extends Document {
    target_type: 'PRODUCT' | 'CATEGORY' | 'TAG';
    target_id: string; // Product ID, Category ID, or Tag name
    forecast_date: Date;
    model_used: 'ARIMA' | 'LSTM';
    predicted_min: mongoose.Types.Decimal128;
    predicted_value: mongoose.Types.Decimal128;
    predicted_max: mongoose.Types.Decimal128;
    interval_confidence: number;
}

const DemandForecastSchema = new Schema<IDemandForecast>({
    target_type: {
        type: String,
        required: true,
        enum: ['PRODUCT', 'CATEGORY', 'TAG']
    },
    target_id: { type: String, required: true, index: true },
    forecast_date: { type: Date, required: true, index: true },
    model_used: {
        type: String,
        required: true,
        enum: ['ARIMA', 'LSTM']
    },
    predicted_min: { type: Schema.Types.Decimal128, required: true },
    predicted_value: { type: Schema.Types.Decimal128, required: true },
    predicted_max: { type: Schema.Types.Decimal128, required: true },
    interval_confidence: { type: Number, default: 95 }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const DemandForecast = mongoose.model<IDemandForecast>('DemandForecast', DemandForecastSchema, 'demand_forecasts');
