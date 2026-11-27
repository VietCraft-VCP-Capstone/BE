import mongoose, { Schema, Document } from 'mongoose';

export type NewsletterSource = 'landing_footer' | 'other';

export interface INewsletterSubscriber extends Document {
    email: string;
    source: NewsletterSource;
    status: 'SUBSCRIBED' | 'UNSUBSCRIBED';
    user_id?: mongoose.Types.ObjectId;
    ip?: string;
    user_agent?: string;
    subscribed_at: Date;
    created_at: Date;
    updated_at: Date;
}

const NewsletterSubscriberSchema = new Schema<INewsletterSubscriber>({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    source: { type: String, enum: ['landing_footer', 'other'], default: 'other' },
    status: { type: String, enum: ['SUBSCRIBED', 'UNSUBSCRIBED'], default: 'SUBSCRIBED', index: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User' },
    ip: { type: String },
    user_agent: { type: String },
    subscribed_at: { type: Date, default: Date.now },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, collection: 'newsletter_subscribers' });

export const NewsletterSubscriber = mongoose.models.NewsletterSubscriber
    || mongoose.model<INewsletterSubscriber>('NewsletterSubscriber', NewsletterSubscriberSchema);
