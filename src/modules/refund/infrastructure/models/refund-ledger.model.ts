import mongoose, { Document, Schema } from 'mongoose';

export type RefundLedgerType = 'PAYMENT_IN' | 'REFUND_HOLD' | 'REFUND_SETTLED' | 'REFUND_RELEASED';

export interface IRefundLedgerEntry extends Document {
    unique_key: string;
    order_id: mongoose.Types.ObjectId;
    refund_id?: mongoose.Types.ObjectId;
    type: RefundLedgerType;
    amount: number;
    reference?: string;
    created_at: Date;
}

const RefundLedgerSchema = new Schema<IRefundLedgerEntry>({
    unique_key: { type: String, required: true, unique: true, index: true },
    order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    refund_id: { type: Schema.Types.ObjectId, ref: 'Refund', index: true },
    type: {
        type: String,
        enum: ['PAYMENT_IN', 'REFUND_HOLD', 'REFUND_SETTLED', 'REFUND_RELEASED'],
        required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    reference: { type: String },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: false },
});

RefundLedgerSchema.index({ order_id: 1, type: 1 });

export const RefundLedgerEntry = mongoose.model<IRefundLedgerEntry>(
    'RefundLedgerEntry',
    RefundLedgerSchema,
    'refund_ledger_entries',
);
