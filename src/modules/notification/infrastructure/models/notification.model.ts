import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
    user_id: mongoose.Types.ObjectId;
    title: string;
    content: string;
    type: 'ORDER_UPDATE' | 'LOW_STOCK' | 'ANALYTICS_ALERT' | 'PROMOTION' | 'NEW_MESSAGE' | 'PRODUCT_UNPUBLISHED' | 'PRODUCT_REPUBLISHED';
    is_read: boolean;
    created_at: Date;
}

const NotificationSchema = new Schema<INotification>({
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    type: {
        type: String,
        required: true,
        enum: ['ORDER_UPDATE', 'LOW_STOCK', 'ANALYTICS_ALERT', 'PROMOTION', 'NEW_MESSAGE', 'PRODUCT_UNPUBLISHED', 'PRODUCT_REPUBLISHED']
    },
    is_read: { type: Boolean, default: false }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: false }
});

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema, 'notifications');
