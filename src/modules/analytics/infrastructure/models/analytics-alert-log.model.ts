import mongoose, { Schema, Document } from 'mongoose';

export interface IAnalyticsAlertLog extends Document {
    shop_id: mongoose.Types.ObjectId;
    metric: 'views' | 'revenue';
    event_date: string;
    notified: boolean;
    emailed: boolean;
}

const AnalyticsAlertLogSchema = new Schema<IAnalyticsAlertLog>({
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    metric: { type: String, enum: ['views', 'revenue'], required: true },
    event_date: { type: String, required: true },
    notified: { type: Boolean, default: false },
    emailed: { type: Boolean, default: false }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: false }
});

AnalyticsAlertLogSchema.index({ shop_id: 1, metric: 1, event_date: 1 }, { unique: true });
AnalyticsAlertLogSchema.index({ shop_id: 1, created_at: -1 });

export const AnalyticsAlertLog = mongoose.model<IAnalyticsAlertLog>('AnalyticsAlertLog', AnalyticsAlertLogSchema, 'analytics_alert_logs');
