import mongoose, { Document, Schema } from 'mongoose';

export const RETURN_REQUEST_V3_ACTIVE_STATUSES = [
    'SUBMITTED', 'PENDING_PRINTER', 'PRINTER_PROPOSED_FAULT_CHANGE', 'APPROVED', 'REJECTED', 'DISPUTED',
    'AWAITING_ADMIN_REFUND', 'WAITING_BUYER_CHOICE', 'WAITING_STOCK', 'CONVERTED_TO_REFUND',
] as const;
export type ReturnRequestV3Status = typeof RETURN_REQUEST_V3_ACTIVE_STATUSES[number]
    | 'ADMIN_REJECTED' | 'REPLACEMENT_CREATED' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';
export type ReturnV3FaultParty = 'BUYER' | 'SELLER' | 'PRINTER' | 'CARRIER' | 'PLATFORM';
export type ReturnV3Resolution = 'EXCHANGE' | 'REFUND';
export type ReturnV3DeadlineType = 'P01' | 'P02' | 'P03' | 'P04' | 'P05' | 'P07' | 'P09' | 'P14' | 'P16' | 'P17' | 'R06_DELIVERED';

export interface IReturnRequestV3 extends Document {
    order_id: string; order_item_id: string; buyer_id: string; seller_id: string; printer_id: string; item_snapshot: Record<string, unknown>;
    quantity: number; reason_code: string; reason_description: string;
    requested_resolution: ReturnV3Resolution; final_resolution: ReturnV3Resolution | null;
    fault_party: ReturnV3FaultParty | null; fault_source: 'SYSTEM' | 'PRINTER_PROPOSED' | 'ADMIN' | null;
    status: ReturnRequestV3Status; version: number; deadline_at: Date | null; deadline_type: ReturnV3DeadlineType | null;
    policy_version: string; schema_version: string; delivered_event_id: string | null; delivered_at: Date | null;
    refund_admin_confirmed: boolean; refund_admin_confirmed_by: string | null; refund_admin_confirmed_at: Date | null;
    correction_used: boolean; printer_evidence_request_used: boolean; buyer_dispute_count: number; seller_appeal_used: boolean; side_effect_started: boolean; exchange_quota_consumed: boolean;
    refund_amount_minor?: number | null; refund_currency?: string | null; admin_decision_id?: string | null; linked_refund_id?: string | null; linked_refund_status?: string | null;
    evidence_requested_at?: Date | null; evidence_deadline_at?: Date | null; buyer_evidence_submitted_at?: Date | null; seller_fault_notified_at?: Date | null; seller_appeal_deadline_at?: Date | null;
    r06_tracking_event_id?: string | null; r06_tracking_event_at?: Date | null; r06_tracking_status?: 'IN_TRANSIT' | 'LOST' | 'RETURNED' | 'DELIVERED' | 'UNKNOWN' | null; r06_tracking_latest_eta?: Date | null; r06_fault_source?: 'CARRIER' | 'PRINTER' | null;
    deadline_reminded_for?: Date | null;
    proposed_fault_party?: ReturnV3FaultParty | null; proposed_classification?: string | null; is_simulated?: boolean;
    replacement_order_id?: string | null; replacement_order_code?: string | null;
    created_at: Date; updated_at: Date;
}

const ReturnRequestV3Schema = new Schema<IReturnRequestV3>({
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
    status: { type: String, enum: [...RETURN_REQUEST_V3_ACTIVE_STATUSES, 'ADMIN_REJECTED', 'REPLACEMENT_CREATED', 'COMPLETED', 'EXPIRED', 'CANCELLED'], required: true },
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
ReturnRequestV3Schema.index({ order_item_id: 1 }, { unique: true, name: 'uniq_active_return_request_v3_per_item_v2', partialFilterExpression: { status: { $in: [...RETURN_REQUEST_V3_ACTIVE_STATUSES] } } });

const ReturnEvidenceV3Schema = new Schema({
    request_id: { type: String, required: true, immutable: true }, evidence_id: { type: String, required: true, immutable: true },
    kind: { type: String, enum: ['PHOTO', 'VIDEO', 'DOCUMENT', 'SYSTEM'], required: true, immutable: true },
    storage_ref: { type: String, required: true, immutable: true }, uploaded_by: { type: String, required: true, immutable: true },
    created_at: { type: Date, required: true, default: Date.now, immutable: true },
}, { versionKey: false, strict: 'throw' });
ReturnEvidenceV3Schema.index({ request_id: 1, evidence_id: 1 }, { unique: true, name: 'uniq_return_evidence_v3' });

const ReturnRequestLogV3Schema = new Schema({
    request_id: { type: String, required: true, immutable: true }, actor_id: { type: String, required: true, immutable: true },
    actor_role: { type: String, enum: ['BUYER', 'SELLER', 'PRINTER', 'ADMIN', 'SYSTEM'], required: true, immutable: true }, acting_as: { type: String, enum: ['PRINTER', null], default: null, immutable: true },
    from_status: { type: String, default: null, immutable: true }, to_status: { type: String, default: null, immutable: true },
    reason: { type: String, required: true, immutable: true }, event_id: { type: String, default: null, immutable: true },
    created_at: { type: Date, required: true, default: Date.now, immutable: true },
}, { versionKey: false, strict: 'throw' });
ReturnRequestLogV3Schema.index({ request_id: 1, created_at: 1 }, { name: 'idx_return_request_v3_audit' });

const ReturnExchangeQuotaV3Schema = new Schema({
    order_item_id: { type: String, required: true, trim: true, immutable: true }, request_id: { type: String, required: true, immutable: true },
    consumed_at: { type: Date, required: true, default: Date.now, immutable: true },
}, { versionKey: false, strict: 'throw' });
ReturnExchangeQuotaV3Schema.index({ order_item_id: 1 }, { unique: true, name: 'uniq_return_exchange_quota_v3_per_item' });

export const ReturnRequestV3 = mongoose.models.ReturnRequestV3 || mongoose.model<IReturnRequestV3>('ReturnRequestV3', ReturnRequestV3Schema, 'return_requests_v3');
export const ReturnEvidenceV3 = mongoose.models.ReturnEvidenceV3 || mongoose.model('ReturnEvidenceV3', ReturnEvidenceV3Schema, 'return_evidence_v3');
export const ReturnRequestLogV3 = mongoose.models.ReturnRequestLogV3 || mongoose.model('ReturnRequestLogV3', ReturnRequestLogV3Schema, 'return_request_logs_v3');
export const ReturnExchangeQuotaV3 = mongoose.models.ReturnExchangeQuotaV3 || mongoose.model('ReturnExchangeQuotaV3', ReturnExchangeQuotaV3Schema, 'return_exchange_quotas_v3');
