import mongoose, { Document, Schema } from 'mongoose';

export const REFUND_STATUSES = ['PENDING_SELLER', 'SELLER_APPROVED', 'SELLER_REJECTED', 'PENDING_PRINTER', 'PRINTER_APPROVED', 'PRINTER_REJECTED', 'DISPUTED', 'ADMIN_APPROVED', 'ADMIN_REJECTED', 'REFUNDED', 'TIMEOUT_ESCALATED'] as const;
export type RefundRequestStatus = typeof REFUND_STATUSES[number];
export type RefundProductType = 'NORMAL' | 'POD';
export type RefundReasonCategory = 'DAMAGED' | 'WRONG_DESCRIPTION' | 'PRINT_DEFECT' | 'MISSING_ITEM' | 'OTHER';
export type RefundDecision = 'APPROVE' | 'REJECT';

export interface IRefundRequest extends Document {
    order_id: mongoose.Types.ObjectId;
    buyer_id: mongoose.Types.ObjectId;
    seller_id: mongoose.Types.ObjectId;
    printer_id?: string;
    product_type: RefundProductType;
    reason_category: RefundReasonCategory;
    description: string;
    evidence: string[];
    refund_type: 'FULL' | 'PARTIAL';
    refund_amount?: number;
    status: RefundRequestStatus;
    responsible_party?: 'SELLER' | 'PRINTER' | 'PLATFORM' | null;
    triage_result?: 'SELLER_RESPONSIBILITY' | 'PRINTER_RESPONSIBILITY' | null;
    triage_checklist?: { evidence_reviewed: boolean; order_verified: boolean; artwork_checked: boolean; seller_terms_checked: boolean; note: string };
    seller_response?: { decision: RefundDecision; note?: string; responded_at: Date };
    printer_response?: { decision: RefundDecision; note?: string; responded_at: Date };
    dispute?: { opened_by: mongoose.Types.ObjectId; reason: string; opened_at: Date };
    admin_decision?: { decided_by: mongoose.Types.ObjectId; decision: RefundDecision; refund_type: 'FULL' | 'PARTIAL'; cost_bearer: 'SELLER' | 'PRINTER' | 'PLATFORM'; note: string; decided_at: Date };
    sla_deadlines: { seller_deadline: Date; printer_deadline?: Date };
    execution_status: 'NOT_STARTED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
    execution_error?: string;
    created_at: Date;
    updated_at: Date;
}

const responseSchema = new Schema({
    decision: { type: String, enum: ['APPROVE', 'REJECT'], required: true },
    note: { type: String, maxlength: 1000 },
    responded_at: { type: Date, required: true },
}, { _id: false });

const RefundRequestSchema = new Schema<IRefundRequest>({
    order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    buyer_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    seller_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    printer_id: { type: String },
    product_type: { type: String, enum: ['NORMAL', 'POD'], required: true },
    reason_category: { type: String, enum: ['DAMAGED', 'WRONG_DESCRIPTION', 'PRINT_DEFECT', 'MISSING_ITEM', 'OTHER'], required: true },
    description: { type: String, required: true, trim: true, minlength: 5, maxlength: 3000 },
    evidence: { type: [String], default: [] },
    refund_type: { type: String, enum: ['FULL', 'PARTIAL'], required: true },
    refund_amount: { type: Number, min: 1 },
    status: { type: String, enum: REFUND_STATUSES, required: true, default: 'PENDING_SELLER', index: true },
    responsible_party: { type: String, enum: ['SELLER', 'PRINTER', 'PLATFORM', null], default: null },
    triage_result: { type: String, enum: ['SELLER_RESPONSIBILITY', 'PRINTER_RESPONSIBILITY', null], default: null },
    triage_checklist: {
        evidence_reviewed: Boolean, order_verified: Boolean, artwork_checked: Boolean,
        seller_terms_checked: Boolean, note: { type: String, maxlength: 1000 },
    },
    seller_response: { type: responseSchema },
    printer_response: { type: responseSchema },
    dispute: { opened_by: { type: Schema.Types.ObjectId, ref: 'User' }, reason: String, opened_at: Date },
    admin_decision: {
        decided_by: { type: Schema.Types.ObjectId, ref: 'User' },
        decision: { type: String, enum: ['APPROVE', 'REJECT'] },
        refund_type: { type: String, enum: ['FULL', 'PARTIAL'] },
        cost_bearer: { type: String, enum: ['SELLER', 'PRINTER', 'PLATFORM'] },
        note: String,
        decided_at: Date,
    },
    sla_deadlines: {
        seller_deadline: { type: Date, required: true },
        printer_deadline: { type: Date },
    },
    execution_status: { type: String, enum: ['NOT_STARTED', 'PROCESSING', 'SUCCEEDED', 'FAILED'], default: 'NOT_STARTED' },
    execution_error: { type: String },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

RefundRequestSchema.index({ status: 1, 'sla_deadlines.seller_deadline': 1 });
RefundRequestSchema.index({ status: 1, 'sla_deadlines.printer_deadline': 1 });
RefundRequestSchema.index({ seller_id: 1, status: 1, created_at: -1 });
RefundRequestSchema.index({ buyer_id: 1, created_at: -1 });

export const RefundRequest = mongoose.model<IRefundRequest>('RefundRequest', RefundRequestSchema, 'refund_requests');
