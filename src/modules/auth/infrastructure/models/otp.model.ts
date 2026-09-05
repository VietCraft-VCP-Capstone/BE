import mongoose, { Schema, Document } from 'mongoose';

export interface IOtpVerification extends Document {
    email: string;
    otp_code: string;
    purpose: 'REGISTER' | 'FORGOT_PASSWORD';
    expired_at: Date;
    temp_password_hash?: string;
    temp_full_name?: string;
    temp_role?: 'BUYER' | 'SELLER';
    attempts: number;
}

const OtpVerificationSchema = new Schema<IOtpVerification>({
    email: { type: String, required: true, index: true },
    otp_code: { type: String, required: true },
    purpose: {
        type: String,
        required: true,
        enum: ['REGISTER', 'FORGOT_PASSWORD']
    },
    expired_at: {
        type: Date,
        required: true,
        index: { expires: 0 }
    },
    temp_password_hash: { type: String },
    temp_full_name: { type: String },
    temp_role: { type: String, enum: ['BUYER', 'SELLER'], default: 'BUYER' },
    attempts: { type: Number, default: 0 }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const OtpVerification = mongoose.model<IOtpVerification>('OtpVerification', OtpVerificationSchema, 'otp_verifications');
