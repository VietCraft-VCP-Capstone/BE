import mongoose, { Schema, Document } from 'mongoose';

export interface IConversationLastMessage {
    text: string;
    sender_id: mongoose.Types.ObjectId;
    created_at: Date;
}

export interface IConversation extends Document {
    conversation_id: string;
    participants: mongoose.Types.ObjectId[];
    shop_id?: mongoose.Types.ObjectId;
    last_message?: IConversationLastMessage;
    unread_counts: Map<string, number>;
    created_at: Date;
    updated_at: Date;
}

const LastMessageSchema = new Schema<IConversationLastMessage>({
    text: { type: String, default: '' },
    sender_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    created_at: { type: Date, default: Date.now }
}, { _id: false });

const ConversationSchema = new Schema<IConversation>({
    conversation_id: { type: String, required: true, unique: true, index: true },
    participants: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop' },
    last_message: { type: LastMessageSchema },
    unread_counts: {
        type: Map,
        of: Number,
        default: {}
    }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

ConversationSchema.index({ participants: 1 });
ConversationSchema.index({ updated_at: -1 });

export const Conversation = mongoose.model<IConversation>('Conversation', ConversationSchema, 'chat_conversations');
