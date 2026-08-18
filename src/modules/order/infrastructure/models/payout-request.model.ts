import mongoose, { Schema, Document } from 'mongoose';

export interface IPayoutBankInfo {
    bank_code: string;
    bank_name: string;
    account_number: string;
    account_holder: string;
}

export interface IPayoutRequest extends Document {
    shop_id: mongoose.Types.ObjectId;
    amount: mongoose.Types.Decimal128;
    bank_info: IPayoutBankInfo;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PROCESSED';
    processed_at?: Date;
    created_at: Date;
}

const PayoutBankInfoSchema = new Schema<IPayoutBankInfo>({
    bank_code: { type: String, required: true },
    bank_name: { type: String, required: true },
    account_number: { type: String, required: true },
    account_holder: { type: String, required: true }
}, { _id: false });

const PayoutRequestSchema = new Schema<IPayoutRequest>({
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    amount: { type: Schema.Types.Decimal128, required: true },
    bank_info: { type: PayoutBankInfoSchema, required: true },
    status: {
        type: String,
        required: true,
        enum: ['PENDING', 'APPROVED', 'REJECTED', 'PROCESSED'],
        default: 'PENDING'
    },
    processed_at: { type: Date }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: false }
});

export const PayoutRequest = mongoose.model<IPayoutRequest>('PayoutRequest', PayoutRequestSchema, 'payout_requests');
