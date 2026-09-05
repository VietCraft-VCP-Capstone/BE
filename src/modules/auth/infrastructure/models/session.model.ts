import mongoose, { Schema, Document } from 'mongoose';

export interface IUserSession extends Document {
    user_id: mongoose.Types.ObjectId;
    refresh_token: string;
    device_info?: string;
    ip_address?: string;
    expires_at: Date;
    is_revoked: boolean;
}

const UserSessionSchema = new Schema<IUserSession>({
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refresh_token: { type: String, required: true, index: true },
    device_info: { type: String },
    ip_address: { type: String },
    expires_at: {
        type: Date,
        required: true,
        index: { expires: 0 }
    },
    is_revoked: { type: Boolean, default: false }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const UserSession = mongoose.model<IUserSession>('UserSession', UserSessionSchema, 'user_sessions');
