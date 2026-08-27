import mongoose, { Schema, Document } from 'mongoose';

export interface IOtpVerification extends Document {
    email: string;
    otp_code: string;
    purpose: 'REGISTER' | 'FORGOT_PASSWORD';
    expired_at: Date;
    temp_password_hash?: string;
    temp_full_name?: string;
    /** Role mong muốn khi đăng ký (BUYER|SELLER). ADMIN không bao giờ được tự đăng ký. */
    temp_role?: 'BUYER' | 'SELLER';
    /** Số lần nhập sai mã — quá ngưỡng thì huỷ mã, chặn dò 6 chữ số. */
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
        index: { expires: 0 } // Document expires at the specific expired_at date
    },
    temp_password_hash: { type: String },
    temp_full_name: { type: String },
    temp_role: { type: String, enum: ['BUYER', 'SELLER'], default: 'BUYER' },
    attempts: { type: Number, default: 0 }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const OtpVerification = mongoose.model<IOtpVerification>('OtpVerification', OtpVerificationSchema, 'otp_verifications');
