import mongoose, { Schema, Document } from 'mongoose';

export type ReputationReferenceType = 'DISPUTE' | 'ORDER' | 'TIMEOUT' | 'STREAK' | 'POD_DESIGN_REJECT' | 'ADMIN_ADJUST';

export interface IReputationLog extends Document {
    shop_id: mongoose.Types.ObjectId;
    delta: number;
    balance_after: number;
    reason: string;
    reference_type: ReputationReferenceType;
    reference_id?: string;
    actor_id?: string;
    actor_role?: string;
    created_at: Date;
}

const ReputationLogSchema = new Schema<IReputationLog>({
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    delta: { type: Number, required: true },
    balance_after: { type: Number, required: true },
    reason: { type: String, required: true },
    reference_type: { 
        type: String, 
        enum: ['DISPUTE', 'ORDER', 'TIMEOUT', 'STREAK', 'POD_DESIGN_REJECT', 'ADMIN_ADJUST'], 
        required: true,
        index: true
    },
    reference_id: { type: String },
    actor_id: { type: String },
    actor_role: { type: String, default: 'SYSTEM' }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: false }
});

ReputationLogSchema.index({ shop_id: 1, reference_id: 1, reference_type: 1 });

export const ReputationLog = mongoose.model<IReputationLog>('ReputationLog', ReputationLogSchema, 'reputation_logs');
