import mongoose, { Document, Schema } from 'mongoose';

export interface ISellerWithdrawal extends Document {
    shop_id: mongoose.Types.ObjectId;
    seller_id: mongoose.Types.ObjectId;
    withdrawal_code: string;
    amount: number;
    bank_name: string;
    bank_code: string;
    account_number: string;
    account_holder: string;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    payout_reference_id?: string;
    payout_transaction_id?: string;
    note?: string;
    failure_reason?: string;
    created_at: Date;
    completed_at?: Date;
    updated_at: Date;
}

const SellerWithdrawalSchema = new Schema<ISellerWithdrawal>(
    {
        shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
        seller_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        withdrawal_code: { type: String, required: true, unique: true, index: true },
        amount: { type: Number, required: true, min: 500 },
        bank_name: { type: String, required: true },
        bank_code: { type: String, required: true },
        account_number: { type: String, required: true },
        account_holder: { type: String, required: true },
        status: {
            type: String,
            enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
            default: 'PENDING',
            index: true,
        },
        payout_reference_id: { type: String },
        payout_transaction_id: { type: String },
        note: { type: String },
        failure_reason: { type: String },
        completed_at: { type: Date },
    },
    {
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
);

export const SellerWithdrawal = mongoose.model<ISellerWithdrawal>('SellerWithdrawal', SellerWithdrawalSchema);
