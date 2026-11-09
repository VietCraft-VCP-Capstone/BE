import mongoose, { Document, Schema } from 'mongoose';

export const RETURN_REQUEST_ACTIVE_STATUSES = [
    'SUBMITTED', 'PENDING_PRINTER', 'PRINTER_PROPOSED_FAULT_CHANGE', 'APPROVED', 'REJECTED', 'DISPUTED',
    'AWAITING_ADMIN_REFUND', 'WAITING_BUYER_CHOICE', 'WAITING_STOCK', 'CONVERTED_TO_REFUND',
] as const;
export type ReturnRequestStatus = typeof RETURN_REQUEST_ACTIVE_STATUSES[number]
    | 'ADMIN_REJECTED' | 'REPLACEMENT_CREATED' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';
export type ReturnRequestFaultParty = 'BUYER' | 'SELLER' | 'PRINTER' | 'CARRIER' | 'PLATFORM';
export type ReturnRequestResolution = 'EXCHANGE' | 'REFUND';
export type ReturnRequestDeadlineType = 'P01' | 'P02' | 'P03' | 'P04' | 'P05' | 'P07' | 'P09' | 'P14' | 'P16' | 'P17' | 'R06_DELIVERED';

export interface IReturnRequest extends Document {
    order_id: string; order_item_id: string; buyer_id: string; seller_id: string; printer_id: string; item_snapshot: Record<string, unknown>;
    quantity: number; reason_code: string; reason_description: string;
    requested_resolution: ReturnRequestResolution; final_resolution: ReturnRequestResolution | null;
    fault_party: ReturnRequestFaultParty | null; fault_source: 'SYSTEM' | 'PRINTER_PROPOSED' | 'ADMIN' | null;
    status: ReturnRequestStatus; version: number; deadline_at: Date | null; deadline_type: ReturnRequestDeadlineType | null;
    policy_version: string; schema_version: string; delivered_event_id: string | null; delivered_at: Date | null;
    refund_admin_confirmed: boolean; refund_admin_confirmed_by: string | null; refund_admin_confirmed_at: Date | null;
    correction_used: boolean; printer_evidence_request_used: boolean; buyer_dispute_count: number; seller_appeal_used: boolean; side_effect_started: boolean; exchange_quota_consumed: boolean;
    refund_amount_minor?: number | null; refund_currency?: string | null; admin_decision_id?: string | null; linked_refund_id?: string | null; linked_refund_status?: string | null;
    evidence_requested_at?: Date | null; evidence_deadline_at?: Date | null; buyer_evidence_submitted_at?: Date | null; seller_fault_notified_at?: Date | null; seller_appeal_deadline_at?: Date | null;
    r06_tracking_event_id?: string | null; r06_tracking_event_at?: Date | null; r06_tracking_status?: 'IN_TRANSIT' | 'LOST' | 'RETURNED' | 'DELIVERED' | 'UNKNOWN' | null; r06_tracking_latest_eta?: Date | null; r06_fault_source?: 'CARRIER' | 'PRINTER' | null;
    deadline_reminded_for?: Date | null;
    proposed_fault_party?: ReturnRequestFaultParty | null; proposed_classification?: string | null; is_simulated?: boolean;
    replacement_order_id?: string | null; replacement_order_code?: string | null;
    created_at: Date; updated_at: Date;
}

const ReturnRequestSchema = new Schema<IReturnRequest>({
    _id: { type: String, required: true },
    item_snapshot: { type: Schema.Types.Mixed, required: true, immutable: true },
    order_id: { type: String, required: true, trim: true, immutable: true },
    order_item_id: { type: String, required: true, trim: true, immutable: true },
    buyer_id: { type: String, required: true, trim: true, immutable: true }, seller_id: { type: String, required: true, trim: true, immutable: true },
    printer_id: { type: String, required: true, trim: true, immutable: true }, quantity: { type: Number, required: true, min: 1, validate: Number.isInteger, immutable: true },
    reason_code: { type: String, required: true, trim: true, uppercase: true, immutable: true }, reason_description: { type: String, required: true, trim: true, immutable: true },
    requested_resolution: { type: String, enum: ['EXCHANGE', 'REFUND'], required: true, immutable: true },
    final_resolution: { type: String, enum: ['EXCHANGE', 'REFUND', null], default: null },
    fault_party: { type: String, enum: ['BUYER', 'SELLER', 'PRINTER', 'CARRIER', 'PLATFORM', null], default: null },
    fault_source: { type: String, enum: ['SYSTEM', 'PRINTER_PROPOSED', 'ADMIN', null], default: null },
    status: { type: String, enum: [...RETURN_REQUEST_ACTIVE_STATUSES, 'ADMIN_REJECTED', 'REPLACEMENT_CREATED', 'COMPLETED', 'EXPIRED', 'CANCELLED'], required: true },
    version: { type: Number, required: true, min: 0, default: 0 }, deadline_at: { type: Date, default: null },
    deadline_type: { type: String, enum: ['P01', 'P02', 'P03', 'P04', 'P05', 'P07', 'P09', 'P14', 'P16', 'P17', 'R06_DELIVERED', null], default: null },
    policy_version: { type: String, required: true, trim: true, immutable: true }, schema_version: { type: String, required: true, trim: true, immutable: true },
    delivered_event_id: { type: String, default: null, immutable: true }, delivered_at: { type: Date, default: null, immutable: true },
    refund_admin_confirmed: { type: Boolean, required: true, default: false }, refund_admin_confirmed_by: { type: String, default: null }, refund_admin_confirmed_at: { type: Date, default: null },
    correction_used: { type: Boolean, required: true, default: false }, printer_evidence_request_used: { type: Boolean, required: true, default: false },
    exchange_quota_consumed: { type: Boolean, required: true, default: false }, buyer_dispute_count: { type: Number, min: 0, default: 0 }, seller_appeal_used: { type: Boolean, required: true, default: false }, side_effect_started: { type: Boolean, required: true, default: false },
 refund_amount_minor: { type: Number, min: 0, default: null }, refund_currency: { type: String, default: null }, admin_decision_id: { type: String, default: null }, linked_refund_id: { type: String, default: null }, linked_refund_status: { type: String, default: null },
 evidence_requested_at: { type: Date, default: null }, evidence_deadline_at: { type: Date, default: null }, buyer_evidence_submitted_at: { type: Date, default: null },
 r06_tracking_event_id: { type: String, default: null }, r06_tracking_event_at: { type: Date, default: null }, r06_tracking_status: { type: String, enum: ['IN_TRANSIT', 'LOST', 'RETURNED', 'DELIVERED', 'UNKNOWN', null], default: null }, r06_tracking_latest_eta: { type: Date, default: null }, r06_fault_source: { type: String, enum: ['CARRIER', 'PRINTER', null], default: null },
 deadline_reminded_for: { type: Date, default: null },
 seller_fault_notified_at: { type: Date, default: null }, seller_appeal_deadline_at: { type: Date, default: null },
 proposed_fault_party: { type: String, enum: ['BUYER', 'SELLER', 'PRINTER', 'CARRIER', 'PLATFORM', null], default: null }, proposed_classification: { type: String, default: null },
 is_simulated: { type: Boolean, default: false, immutable: true },
 replacement_order_id: { type: String, default: null }, replacement_order_code: { type: String, default: null },
 }, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, versionKey: false, strict: 'throw' });
ReturnRequestSchema.index({ order_item_id: 1 }, { unique: true, name: 'uniq_active_return_request_v3_per_item_v2', partialFilterExpression: { status: { $in: [...RETURN_REQUEST_ACTIVE_STATUSES] } } });

const ReturnEvidenceSchema = new Schema({
    request_id: { type: String, required: true, immutable: true }, evidence_id: { type: String, required: true, immutable: true },
    kind: { type: String, enum: ['PHOTO', 'VIDEO', 'DOCUMENT', 'SYSTEM'], required: true, immutable: true },
    storage_ref: { type: String, required: true, immutable: true }, uploaded_by: { type: String, required: true, immutable: true },
    created_at: { type: Date, required: true, default: Date.now, immutable: true },
}, { versionKey: false, strict: 'throw' });
ReturnEvidenceSchema.index({ request_id: 1, evidence_id: 1 }, { unique: true, name: 'uniq_return_evidence_v3' });

const ReturnRequestLogSchema = new Schema({
    request_id: { type: String, required: true, immutable: true }, actor_id: { type: String, required: true, immutable: true },
    actor_role: { type: String, enum: ['BUYER', 'SELLER', 'PRINTER', 'ADMIN', 'SYSTEM'], required: true, immutable: true }, acting_as: { type: String, enum: ['PRINTER', null], default: null, immutable: true },
    from_status: { type: String, default: null, immutable: true }, to_status: { type: String, default: null, immutable: true },
    reason: { type: String, required: true, immutable: true }, event_id: { type: String, default: null, immutable: true },
    created_at: { type: Date, required: true, default: Date.now, immutable: true },
}, { versionKey: false, strict: 'throw' });
ReturnRequestLogSchema.index({ request_id: 1, created_at: 1 }, { name: 'idx_return_request_v3_audit' });

const ReturnExchangeQuotaSchema = new Schema({
    order_item_id: { type: String, required: true, trim: true, immutable: true }, request_id: { type: String, required: true, immutable: true },
    consumed_at: { type: Date, required: true, default: Date.now, immutable: true },
}, { versionKey: false, strict: 'throw' });
ReturnExchangeQuotaSchema.index({ order_item_id: 1 }, { unique: true, name: 'uniq_return_exchange_quota_v3_per_item' });

export const ReturnRequest = mongoose.models.ReturnRequest || mongoose.model<IReturnRequest>('ReturnRequest', ReturnRequestSchema, 'return_requests');
export const ReturnEvidence = mongoose.models.ReturnEvidence || mongoose.model('ReturnEvidence', ReturnEvidenceSchema, 'return_evidence');
export const ReturnRequestLog = mongoose.models.ReturnRequestLog || mongoose.model('ReturnRequestLog', ReturnRequestLogSchema, 'return_request_logs');
export const ReturnExchangeQuota = mongoose.models.ReturnExchangeQuota || mongoose.model('ReturnExchangeQuota', ReturnExchangeQuotaSchema, 'return_exchange_quotas');
