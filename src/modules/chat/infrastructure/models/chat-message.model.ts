import mongoose, { Schema, Document } from 'mongoose';

export interface IProductWidget {
    product_id: mongoose.Types.ObjectId;
    title: string;
    price: mongoose.Types.Decimal128;
    image: string;
}

export interface ICustomQuotation {
    amount: mongoose.Types.Decimal128;
    design_url: string;
    status: 'OFFERED' | 'ACCEPTED' | 'REJECTED';
}

export interface IChatMessage extends Document {
    conversation_id: string;
    sender_id: mongoose.Types.ObjectId;
    receiver_id: mongoose.Types.ObjectId;
    product_widget?: IProductWidget;
    custom_quotation?: ICustomQuotation;
    message_text?: string;
    attachments: string[];
    is_read: boolean;
    created_at: Date;
}

const ProductWidgetSchema = new Schema<IProductWidget>({
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    title: { type: String, required: true },
    price: { type: Schema.Types.Decimal128, required: true },
    image: { type: String, required: true }
}, { _id: false });

const CustomQuotationSchema = new Schema<ICustomQuotation>({
    amount: { type: Schema.Types.Decimal128, required: true },
    design_url: { type: String, required: true },
    status: {
        type: String,
        required: true,
        enum: ['OFFERED', 'ACCEPTED', 'REJECTED'],
        default: 'OFFERED'
    }
}, { _id: false });

const ChatMessageSchema = new Schema<IChatMessage>({
    conversation_id: { type: String, required: true, index: true },
    sender_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiver_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    product_widget: { type: ProductWidgetSchema },
    custom_quotation: { type: CustomQuotationSchema },
    message_text: { type: String },
    attachments: { type: [String], default: [] },
    is_read: { type: Boolean, default: false }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: false }
});

ChatMessageSchema.index({ conversation_id: 1, created_at: 1 });
ChatMessageSchema.index({ receiver_id: 1, is_read: 1 });

export const ChatMessage = mongoose.model<IChatMessage>('ChatMessage', ChatMessageSchema, 'chat_messages');
