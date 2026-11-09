import mongoose from 'mongoose';
import {
    ReturnEvidence, ReturnExchangeQuota, ReturnRequestLog, ReturnRequest, RETURN_REQUEST_ACTIVE_STATUSES,
    type ReturnRequestStatus, type ReturnRequestDeadlineType, type ReturnRequestFaultParty, type ReturnRequestResolution,
} from '../models/return-request.model';

export interface ReturnRequestData {
    id: string; order_id: string; order_item_id: string; buyer_id: string; seller_id: string; printer_id: string; item_snapshot: Record<string, unknown>;
    quantity: number; reason_code: string; reason_description: string; requested_resolution: ReturnRequestResolution; final_resolution: ReturnRequestResolution | null;
    fault_party: ReturnRequestFaultParty | null; fault_source: string | null; status: ReturnRequestStatus; version: number;
    deadline_at: Date | null; deadline_type: ReturnRequestDeadlineType | null; policy_version: string; schema_version: string;
    delivered_event_id: string | null; delivered_at: Date | null; refund_admin_confirmed: boolean; refund_admin_confirmed_by: string | null;
    refund_admin_confirmed_at: Date | null; correction_used: boolean; printer_evidence_request_used: boolean; buyer_dispute_count: number;
    seller_appeal_used: boolean; side_effect_started: boolean; exchange_quota_consumed: boolean; refund_amount_minor?: number | null; refund_currency?: string | null; admin_decision_id?: string | null; linked_refund_id?: string | null; linked_refund_status?: string | null;
    evidence_requested_at?: Date | null; evidence_deadline_at?: Date | null; buyer_evidence_submitted_at?: Date | null; seller_fault_notified_at?: Date | null; seller_appeal_deadline_at?: Date | null;
    r06_tracking_event_id?: string | null; r06_tracking_event_at?: Date | null; r06_tracking_status?: 'IN_TRANSIT'|'LOST'|'RETURNED'|'DELIVERED'|'UNKNOWN'|null; r06_tracking_latest_eta?: Date | null; r06_fault_source?: 'CARRIER'|'PRINTER'|null;
    proposed_fault_party?: ReturnRequestFaultParty | null; proposed_classification?: string | null; is_simulated?: boolean;
    replacement_order_id?: string | null; replacement_order_code?: string | null;
    created_at: Date; updated_at: Date;
}
export type ReturnRequestPatch = Partial<Omit<ReturnRequestData, 'id' | 'order_id' | 'order_item_id' | 'created_at' | 'version'>>;
export interface ReturnEvidenceData { request_id: string; evidence_id: string; kind: 'PHOTO'|'VIDEO'|'DOCUMENT'|'SYSTEM'; storage_ref: string; uploaded_by: string; created_at: Date }
export interface ReturnRequestLogData { request_id: string; actor_id: string; actor_role: 'BUYER'|'SELLER'|'PRINTER'|'ADMIN'|'SYSTEM'; acting_as?: 'PRINTER'; from_status: string|null; to_status: string|null; reason: string; event_id: string|null; created_at: Date }

export class ReturnRequestConflictError extends Error {
    readonly statusCode = 409;
    constructor(message = 'Return request version or active-item uniqueness conflict.') { super(message); this.name = 'ReturnRequestConflictError'; }
}
export type ReturnRequestActorRole = 'BUYER' | 'SELLER' | 'PRINTER' | 'ADMIN';
export interface ReturnRequestListQuery { role: ReturnRequestActorRole; actorId: string; status?: string; page?: number; pageSize?: number }
export interface ReturnRequestListResult { items: ReturnRequestData[]; total: number; page: number; pageSize: number }
export interface ReturnRequestDetail { request: ReturnRequestData; timeline: ReturnRequestLogData[]; evidence: ReturnEvidenceData[] }

export interface ReturnRequestRepository {
    listByRole(query: ReturnRequestListQuery): Promise<ReturnRequestListResult>;
    findDetail(id: string): Promise<ReturnRequestDetail | null>;
    finalizeExchangeWithAudit(id: string, expectedVersion: number, orderItemId: string, requestId: string, at: Date, patch: ReturnRequestPatch, log: ReturnRequestLogData): Promise<ReturnRequestData>;
    create(request: ReturnRequestData): Promise<ReturnRequestData>;
    createWithAudit(request: ReturnRequestData, evidence: ReturnEvidenceData[], log: ReturnRequestLogData): Promise<ReturnRequestData>;
    findById(id: string): Promise<ReturnRequestData | null>;
    findActiveByItem(orderItemId: string): Promise<ReturnRequestData | null>;
    listActiveByOrder(orderId: string): Promise<ReturnRequestData[]>;
    casTransition(id: string, expectedVersion: number, patch: ReturnRequestPatch, log: ReturnRequestLogData): Promise<ReturnRequestData>;
    transitionWithAudit(id: string, expectedVersion: number, patch: ReturnRequestPatch, log: ReturnRequestLogData, evidence?: ReturnEvidenceData[]): Promise<ReturnRequestData>;
    appendEvidence(evidence: ReturnEvidenceData): Promise<void>;
    appendLog(log: ReturnRequestLogData): Promise<void>;
    listEvidence(requestId: string): Promise<ReturnEvidenceData[]>;
    listLogs(requestId: string): Promise<ReturnRequestLogData[]>;
}
export type ExchangeQuotaResult = 'CONSUMED'|'SAME_REQUEST'|'CONFLICT';
export interface ReturnExchangeQuotaRepository { consumeOnce(orderItemId: string, requestId: string, at: Date): Promise<ExchangeQuotaResult> }

const ACTIVE_STATUS_VALUES = new Set<string>(RETURN_REQUEST_ACTIVE_STATUSES);
const immutableRequestFields: readonly (keyof ReturnRequestPatch)[] = ['buyer_id','seller_id','printer_id','item_snapshot','quantity','reason_code','reason_description','requested_resolution','policy_version','schema_version','delivered_event_id','delivered_at','is_simulated'];
function assertImmutable(current:ReturnRequestData,patch:ReturnRequestPatch):void {
    for(const key of immutableRequestFields) if(key in patch && JSON.stringify(current[key])!==JSON.stringify(patch[key])) throw new Error(`Immutable return snapshot field cannot change: ${key}`);
}
function duplicateKey(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as {code?: unknown}).code === 11000; }
function asRequest(doc: any): ReturnRequestData { const { _id, ...data } = doc; return { ...data, id: String(_id) }; }

export class InMemoryReturnRequestRepository implements ReturnRequestRepository, ReturnExchangeQuotaRepository {
    private readonly requests = new Map<string, ReturnRequestData>();
    private readonly evidence: ReturnEvidenceData[] = [];
    private readonly logs: ReturnRequestLogData[] = [];
    private readonly quotas = new Map<string, string>();
    async finalizeExchangeWithAudit(id:string,version:number,item:string,requestId:string,at:Date,patch:ReturnRequestPatch,log:ReturnRequestLogData):Promise<ReturnRequestData>{
        const current=this.requests.get(id); if(!current||current.version!==version) throw new ReturnRequestConflictError();
        if(current.final_resolution!=='EXCHANGE'||current.status!=='APPROVED') throw new Error('Only an approved Exchange may consume quota.');
        if(patch.status && patch.status!=='APPROVED') throw new Error('Replacement creation/completion is disabled in Phase 1.');
        assertImmutable(current,patch);
        const consumed=this.quotas.get(item); if(consumed===requestId && current.exchange_quota_consumed) return structuredClone(current); if(consumed&&consumed!==requestId) throw new ReturnRequestConflictError('Exchange quota already consumed for this item.');
        if(!consumed) this.quotas.set(item,requestId); const saved={...current,...structuredClone(patch),exchange_quota_consumed:true,version:current.version+1,updated_at:patch.updated_at??at};
        this.requests.set(id,saved); this.logs.push(structuredClone(log)); return structuredClone(saved);
    }
    async create(request: ReturnRequestData): Promise<ReturnRequestData> {
        const active=[...this.requests.values()].some(item=>item.order_item_id===request.order_item_id&&ACTIVE_STATUS_VALUES.has(item.status));
        if(this.requests.has(request.id)||active) throw new ReturnRequestConflictError();
        const saved=structuredClone(request); this.requests.set(saved.id,saved); return structuredClone(saved);
    }
    async createWithAudit(request: ReturnRequestData, evidence: ReturnEvidenceData[], log: ReturnRequestLogData): Promise<ReturnRequestData> {
        const evidenceKeys=new Set<string>(); for(const item of evidence){const key=`${item.request_id}:${item.evidence_id}`;if(evidenceKeys.has(key)||this.evidence.some(existing=>existing.request_id===item.request_id&&existing.evidence_id===item.evidence_id))throw new ReturnRequestConflictError('Duplicate evidence ID for request.');evidenceKeys.add(key);}
        const active = [...this.requests.values()].find(value => value.order_item_id === request.order_item_id && ACTIVE_STATUS_VALUES.has(value.status));
        if (this.requests.has(request.id) || active) throw new ReturnRequestConflictError();
        const saved = structuredClone(request); this.requests.set(saved.id, saved);
        this.evidence.push(...structuredClone(evidence)); this.logs.push(structuredClone(log)); return structuredClone(saved);
    }
    async listByRole(query: ReturnRequestListQuery): Promise<ReturnRequestListResult> {
        const page = Math.max(1, Math.floor(query.page || 1)); const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize || 20)));
        const key = query.role === 'BUYER' ? 'buyer_id' : query.role === 'SELLER' ? 'seller_id' : query.role === 'PRINTER' ? 'printer_id' : null;
        const rows = [...this.requests.values()].filter(item => (!key || item[key] === query.actorId) && (!query.status || item.status === query.status)).sort((a,b) => b.created_at.getTime() - a.created_at.getTime());
        return { items: structuredClone(rows.slice((page - 1) * pageSize, page * pageSize)), total: rows.length, page, pageSize };
    }
    async findDetail(id: string): Promise<ReturnRequestDetail | null> {
        const request = await this.findById(id); if (!request) return null;
        return { request, timeline: await this.listLogs(id), evidence: await this.listEvidence(id) };
    }
    async findById(id: string): Promise<ReturnRequestData | null> { const value = this.requests.get(id); return value ? structuredClone(value) : null; }
    async findActiveByItem(item: string): Promise<ReturnRequestData | null> {
        const value = [...this.requests.values()].find(request => request.order_item_id === item && ACTIVE_STATUS_VALUES.has(request.status));
        return value ? structuredClone(value) : null;
    }
    async listActiveByOrder(orderId: string): Promise<ReturnRequestData[]> { return [...this.requests.values()].filter(request => request.order_id === orderId && ACTIVE_STATUS_VALUES.has(request.status)).map(request => structuredClone(request)); }
    async transitionWithAudit(id: string, expectedVersion: number, patch: ReturnRequestPatch, log: ReturnRequestLogData, evidence: ReturnEvidenceData[] = []): Promise<ReturnRequestData> {
        const current = this.requests.get(id);
        if (!current || current.version !== expectedVersion) throw new ReturnRequestConflictError();
        assertImmutable(current,patch);
        const evidenceKeys=new Set<string>(); for(const item of evidence){const key=`${item.request_id}:${item.evidence_id}`;if(evidenceKeys.has(key)||this.evidence.some(existing=>existing.request_id===item.request_id&&existing.evidence_id===item.evidence_id))throw new ReturnRequestConflictError('Duplicate evidence ID for request.');evidenceKeys.add(key);}
        const saved = { ...current, ...structuredClone(patch), version: current.version + 1, updated_at: patch.updated_at ?? current.updated_at };
        this.requests.set(id, saved); this.evidence.push(...structuredClone(evidence)); this.logs.push(structuredClone(log)); return structuredClone(saved);
    }
    async casTransition(id: string, expectedVersion: number, patch: ReturnRequestPatch, log:ReturnRequestLogData): Promise<ReturnRequestData> {
        const current = this.requests.get(id);
        if (!current || current.version !== expectedVersion) throw new ReturnRequestConflictError();
        assertImmutable(current,patch);
        const saved = { ...current, ...structuredClone(patch), version: current.version + 1, updated_at: patch.updated_at ?? current.updated_at };
        this.requests.set(id, saved); this.logs.push(structuredClone(log)); return structuredClone(saved);
    }
    async appendEvidence(value: ReturnEvidenceData): Promise<void> { if(this.evidence.some(item=>item.request_id===value.request_id&&item.evidence_id===value.evidence_id)) throw new ReturnRequestConflictError('Duplicate evidence ID for request.'); this.evidence.push(structuredClone(value)); }
    async appendLog(value: ReturnRequestLogData): Promise<void> { this.logs.push(structuredClone(value)); }
    async listEvidence(id: string): Promise<ReturnEvidenceData[]> { return structuredClone(this.evidence.filter(item => item.request_id === id)); }
    async listLogs(id: string): Promise<ReturnRequestLogData[]> { return structuredClone(this.logs.filter(item => item.request_id === id)); }
    async consumeOnce(item: string, requestId: string, at: Date): Promise<ExchangeQuotaResult> {
        if(!Number.isFinite(at.getTime())) throw new Error('Valid quota timestamp is required.');
        const existing = this.quotas.get(item); if (existing === requestId) return 'SAME_REQUEST'; if (existing) return 'CONFLICT'; this.quotas.set(item, requestId); return 'CONSUMED';
    }
}

export class MongoReturnRequestRepository implements ReturnRequestRepository, ReturnExchangeQuotaRepository {
    async finalizeExchangeWithAudit(id:string,version:number,item:string,requestId:string,at:Date,patch:ReturnRequestPatch,log:ReturnRequestLogData):Promise<ReturnRequestData>{
        const session=await mongoose.startSession(); let saved:ReturnRequestData|null=null;
        try { await session.withTransaction(async()=>{
            const doc=await ReturnRequest.findOneAndUpdate({_id:id,version,final_resolution:'EXCHANGE',exchange_quota_consumed:false},{ $set:{...patch,exchange_quota_consumed:true},$inc:{version:1} },{new:true,runValidators:true,session}).lean();
            if(!doc) throw new ReturnRequestConflictError();
            await ReturnExchangeQuota.create([{order_item_id:item,request_id:requestId,consumed_at:at}],{session});
            await ReturnRequestLog.create([log],{session}); saved=asRequest(doc);
        }); } catch(error) { if(duplicateKey(error)) throw new ReturnRequestConflictError('Exchange quota or request version conflict.'); throw error; }
        finally { await session.endSession(); }
        if(!saved) throw new ReturnRequestConflictError(); return saved;
    }
    async create(request: ReturnRequestData): Promise<ReturnRequestData> {
        try { const { id, ...fields } = request; const doc = await ReturnRequest.create({ ...fields, _id: id }); return asRequest(doc.toObject()); }
        catch (error) { if (duplicateKey(error)) throw new ReturnRequestConflictError(); throw error; }
    }
    async createWithAudit(request: ReturnRequestData, evidence: ReturnEvidenceData[], log: ReturnRequestLogData): Promise<ReturnRequestData> {
        const session = await mongoose.startSession(); let saved: ReturnRequestData | null = null;
        try {
            await session.withTransaction(async () => {
                const { id, ...fields } = request;
                const [doc] = await ReturnRequest.create([{ ...fields, _id: id }], { session });
                if (evidence.length) await ReturnEvidence.create(evidence, { session });
                await ReturnRequestLog.create([log], { session });
                saved = asRequest(doc.toObject());
            });
        } catch (error) { if (duplicateKey(error)) throw new ReturnRequestConflictError(); throw error; }
        finally { await session.endSession(); }
        if (!saved) throw new Error('Failed to persist return request and audit in one transaction.');
        return saved;
    }
    async listByRole(query: ReturnRequestListQuery): Promise<ReturnRequestListResult> {
        const page = Math.max(1, Math.floor(query.page || 1)); const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize || 20)));
        const filter: Record<string, unknown> = query.role === 'ADMIN' ? {} : { [query.role === 'BUYER' ? 'buyer_id' : query.role === 'SELLER' ? 'seller_id' : 'printer_id']: query.actorId };
        if (query.status) filter.status = query.status;
        const [docs, total] = await Promise.all([
            ReturnRequest.find(filter).sort({ created_at: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
            ReturnRequest.countDocuments(filter),
        ]);
        return { items: docs.map(asRequest), total, page, pageSize };
    }
    async findDetail(id: string): Promise<ReturnRequestDetail | null> {
        const request = await this.findById(id); if (!request) return null;
        const [timeline, evidence] = await Promise.all([this.listLogs(id), this.listEvidence(id)]);
        return { request, timeline, evidence };
    }
    async findById(id: string): Promise<ReturnRequestData | null> { const doc = await ReturnRequest.findById(id).lean(); return doc ? asRequest(doc) : null; }
    async findActiveByItem(item: string): Promise<ReturnRequestData | null> { const doc = await ReturnRequest.findOne({ order_item_id: item, status: { $in: [...RETURN_REQUEST_ACTIVE_STATUSES] } }).lean(); return doc ? asRequest(doc) : null; }
    async listActiveByOrder(orderId: string): Promise<ReturnRequestData[]> { return (await ReturnRequest.find({ order_id: orderId, status: { $in: [...RETURN_REQUEST_ACTIVE_STATUSES] } }).lean()).map(asRequest); }
    async transitionWithAudit(id: string, expectedVersion: number, patch: ReturnRequestPatch, log: ReturnRequestLogData, evidence: ReturnEvidenceData[] = []): Promise<ReturnRequestData> {
        const session = await mongoose.startSession(); let saved: ReturnRequestData | null = null;
        try {
            await session.withTransaction(async () => {
                const doc = await ReturnRequest.findOneAndUpdate({ _id: id, version: expectedVersion }, { $set: patch, $inc: { version: 1 } }, { new: true, runValidators: true, session }).lean();
                if (!doc) throw new ReturnRequestConflictError();
                if (evidence.length) await ReturnEvidence.create(evidence, { session });
                await ReturnRequestLog.create([log], { session }); saved = asRequest(doc);
            });
        } finally { await session.endSession(); }
        if (!saved) throw new ReturnRequestConflictError(); return saved;
    }
    async casTransition(id: string, expectedVersion: number, patch: ReturnRequestPatch, log:ReturnRequestLogData): Promise<ReturnRequestData> { return this.transitionWithAudit(id,expectedVersion,patch,log); }
    async appendEvidence(value: ReturnEvidenceData): Promise<void> { await ReturnEvidence.create(value); }
    async appendLog(value: ReturnRequestLogData): Promise<void> { await ReturnRequestLog.create(value); }
    async listEvidence(id: string): Promise<ReturnEvidenceData[]> { return (await ReturnEvidence.find({ request_id: id }).sort({ created_at: 1 }).lean()) as unknown as ReturnEvidenceData[]; }
    async listLogs(id: string): Promise<ReturnRequestLogData[]> { return (await ReturnRequestLog.find({ request_id: id }).sort({ created_at: 1 }).lean()) as unknown as ReturnRequestLogData[]; }
    async consumeOnce(item: string, requestId: string, at: Date): Promise<ExchangeQuotaResult> {
        try { await ReturnExchangeQuota.create({ order_item_id: item, request_id: requestId, consumed_at: at }); return 'CONSUMED'; }
        catch (error) { if (!duplicateKey(error)) throw error; const existing = await ReturnExchangeQuota.findOne({ order_item_id: item }).lean() as { request_id?: string } | null; return existing?.request_id === requestId ? 'SAME_REQUEST' : 'CONFLICT'; }
    }
}

export function isMongoReturnRequestDuplicate(error: unknown): boolean { return duplicateKey(error) || error instanceof mongoose.mongo.MongoServerError && error.code === 11000; }
