import mongoose from 'mongoose';
import {
    ReturnEvidenceV3, ReturnExchangeQuotaV3, ReturnRequestLogV3, ReturnRequestV3, RETURN_REQUEST_V3_ACTIVE_STATUSES,
    type ReturnRequestV3Status, type ReturnV3DeadlineType, type ReturnV3FaultParty, type ReturnV3Resolution,
} from '../models/return-request-v3.model';

export interface ReturnRequestV3Data {
    id: string; order_id: string; order_item_id: string; buyer_id: string; seller_id: string; printer_id: string; item_snapshot: Record<string, unknown>;
    quantity: number; reason_code: string; reason_description: string; requested_resolution: ReturnV3Resolution; final_resolution: ReturnV3Resolution | null;
    fault_party: ReturnV3FaultParty | null; fault_source: string | null; status: ReturnRequestV3Status; version: number;
    deadline_at: Date | null; deadline_type: ReturnV3DeadlineType | null; policy_version: string; schema_version: string;
    delivered_event_id: string | null; delivered_at: Date | null; refund_admin_confirmed: boolean; refund_admin_confirmed_by: string | null;
    refund_admin_confirmed_at: Date | null; correction_used: boolean; printer_evidence_request_used: boolean; buyer_dispute_count: number;
    seller_appeal_used: boolean; side_effect_started: boolean; exchange_quota_consumed: boolean; refund_amount_minor?: number | null; refund_currency?: string | null; admin_decision_id?: string | null; linked_refund_id?: string | null; linked_refund_status?: string | null;
    evidence_requested_at?: Date | null; evidence_deadline_at?: Date | null; buyer_evidence_submitted_at?: Date | null; seller_fault_notified_at?: Date | null; seller_appeal_deadline_at?: Date | null;
    r06_tracking_event_id?: string | null; r06_tracking_event_at?: Date | null; r06_tracking_status?: 'IN_TRANSIT'|'LOST'|'RETURNED'|'DELIVERED'|'UNKNOWN'|null; r06_tracking_latest_eta?: Date | null; r06_fault_source?: 'CARRIER'|'PRINTER'|null;
    proposed_fault_party?: ReturnV3FaultParty | null; proposed_classification?: string | null; is_simulated?: boolean;
    replacement_order_id?: string | null; replacement_order_code?: string | null;
    created_at: Date; updated_at: Date;
}
export type ReturnRequestV3Patch = Partial<Omit<ReturnRequestV3Data, 'id' | 'order_id' | 'order_item_id' | 'created_at' | 'version'>>;
export interface ReturnEvidenceV3Data { request_id: string; evidence_id: string; kind: 'PHOTO'|'VIDEO'|'DOCUMENT'|'SYSTEM'; storage_ref: string; uploaded_by: string; created_at: Date }
export interface ReturnRequestLogV3Data { request_id: string; actor_id: string; actor_role: 'BUYER'|'SELLER'|'PRINTER'|'ADMIN'|'SYSTEM'; acting_as?: 'PRINTER'; from_status: string|null; to_status: string|null; reason: string; event_id: string|null; created_at: Date }

export class ReturnRequestV3ConflictError extends Error {
    readonly statusCode = 409;
    constructor(message = 'Return request version or active-item uniqueness conflict.') { super(message); this.name = 'ReturnRequestV3ConflictError'; }
}
export type ReturnRequestV3ActorRole = 'BUYER' | 'SELLER' | 'PRINTER' | 'ADMIN';
export interface ReturnRequestV3ListQuery { role: ReturnRequestV3ActorRole; actorId: string; status?: string; page?: number; pageSize?: number }
export interface ReturnRequestV3ListResult { items: ReturnRequestV3Data[]; total: number; page: number; pageSize: number }
export interface ReturnRequestV3Detail { request: ReturnRequestV3Data; timeline: ReturnRequestLogV3Data[]; evidence: ReturnEvidenceV3Data[] }

export interface ReturnRequestV3Repository {
    listByRole(query: ReturnRequestV3ListQuery): Promise<ReturnRequestV3ListResult>;
    findDetail(id: string): Promise<ReturnRequestV3Detail | null>;
    finalizeExchangeWithAudit(id: string, expectedVersion: number, orderItemId: string, requestId: string, at: Date, patch: ReturnRequestV3Patch, log: ReturnRequestLogV3Data): Promise<ReturnRequestV3Data>;
    create(request: ReturnRequestV3Data): Promise<ReturnRequestV3Data>;
    createWithAudit(request: ReturnRequestV3Data, evidence: ReturnEvidenceV3Data[], log: ReturnRequestLogV3Data): Promise<ReturnRequestV3Data>;
    findById(id: string): Promise<ReturnRequestV3Data | null>;
    findActiveByItem(orderItemId: string): Promise<ReturnRequestV3Data | null>;
    listActiveByOrder(orderId: string): Promise<ReturnRequestV3Data[]>;
    casTransition(id: string, expectedVersion: number, patch: ReturnRequestV3Patch, log: ReturnRequestLogV3Data): Promise<ReturnRequestV3Data>;
    transitionWithAudit(id: string, expectedVersion: number, patch: ReturnRequestV3Patch, log: ReturnRequestLogV3Data, evidence?: ReturnEvidenceV3Data[]): Promise<ReturnRequestV3Data>;
    appendEvidence(evidence: ReturnEvidenceV3Data): Promise<void>;
    appendLog(log: ReturnRequestLogV3Data): Promise<void>;
    listEvidence(requestId: string): Promise<ReturnEvidenceV3Data[]>;
    listLogs(requestId: string): Promise<ReturnRequestLogV3Data[]>;
}
export type ExchangeQuotaResult = 'CONSUMED'|'SAME_REQUEST'|'CONFLICT';
export interface ReturnExchangeQuotaRepository { consumeOnce(orderItemId: string, requestId: string, at: Date): Promise<ExchangeQuotaResult> }

const ACTIVE_STATUS_VALUES = new Set<string>(RETURN_REQUEST_V3_ACTIVE_STATUSES);
const immutableRequestFields: readonly (keyof ReturnRequestV3Patch)[] = ['buyer_id','seller_id','printer_id','item_snapshot','quantity','reason_code','reason_description','requested_resolution','policy_version','schema_version','delivered_event_id','delivered_at','is_simulated'];
function assertImmutable(current:ReturnRequestV3Data,patch:ReturnRequestV3Patch):void {
    for(const key of immutableRequestFields) if(key in patch && JSON.stringify(current[key])!==JSON.stringify(patch[key])) throw new Error(`Immutable return snapshot field cannot change: ${key}`);
}
function duplicateKey(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as {code?: unknown}).code === 11000; }
function asRequest(doc: any): ReturnRequestV3Data { const { _id, ...data } = doc; return { ...data, id: String(_id) }; }

export class InMemoryReturnRequestV3Repository implements ReturnRequestV3Repository, ReturnExchangeQuotaRepository {
    private readonly requests = new Map<string, ReturnRequestV3Data>();
    private readonly evidence: ReturnEvidenceV3Data[] = [];
    private readonly logs: ReturnRequestLogV3Data[] = [];
    private readonly quotas = new Map<string, string>();
    async finalizeExchangeWithAudit(id:string,version:number,item:string,requestId:string,at:Date,patch:ReturnRequestV3Patch,log:ReturnRequestLogV3Data):Promise<ReturnRequestV3Data>{
        const current=this.requests.get(id); if(!current||current.version!==version) throw new ReturnRequestV3ConflictError();
        if(current.final_resolution!=='EXCHANGE'||current.status!=='APPROVED') throw new Error('Only an approved Exchange may consume quota.');
        if(patch.status && patch.status!=='APPROVED') throw new Error('Replacement creation/completion is disabled in Phase 1.');
        assertImmutable(current,patch);
        const consumed=this.quotas.get(item); if(consumed===requestId && current.exchange_quota_consumed) return structuredClone(current); if(consumed&&consumed!==requestId) throw new ReturnRequestV3ConflictError('Exchange quota already consumed for this item.');
        if(!consumed) this.quotas.set(item,requestId); const saved={...current,...structuredClone(patch),exchange_quota_consumed:true,version:current.version+1,updated_at:patch.updated_at??at};
        this.requests.set(id,saved); this.logs.push(structuredClone(log)); return structuredClone(saved);
    }
    async create(request: ReturnRequestV3Data): Promise<ReturnRequestV3Data> {
        const active=[...this.requests.values()].some(item=>item.order_item_id===request.order_item_id&&ACTIVE_STATUS_VALUES.has(item.status));
        if(this.requests.has(request.id)||active) throw new ReturnRequestV3ConflictError();
        const saved=structuredClone(request); this.requests.set(saved.id,saved); return structuredClone(saved);
    }
    async createWithAudit(request: ReturnRequestV3Data, evidence: ReturnEvidenceV3Data[], log: ReturnRequestLogV3Data): Promise<ReturnRequestV3Data> {
        const evidenceKeys=new Set<string>(); for(const item of evidence){const key=`${item.request_id}:${item.evidence_id}`;if(evidenceKeys.has(key)||this.evidence.some(existing=>existing.request_id===item.request_id&&existing.evidence_id===item.evidence_id))throw new ReturnRequestV3ConflictError('Duplicate evidence ID for request.');evidenceKeys.add(key);}
        const active = [...this.requests.values()].find(value => value.order_item_id === request.order_item_id && ACTIVE_STATUS_VALUES.has(value.status));
        if (this.requests.has(request.id) || active) throw new ReturnRequestV3ConflictError();
        const saved = structuredClone(request); this.requests.set(saved.id, saved);
        this.evidence.push(...structuredClone(evidence)); this.logs.push(structuredClone(log)); return structuredClone(saved);
    }
    async listByRole(query: ReturnRequestV3ListQuery): Promise<ReturnRequestV3ListResult> {
        const page = Math.max(1, Math.floor(query.page || 1)); const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize || 20)));
        const key = query.role === 'BUYER' ? 'buyer_id' : query.role === 'SELLER' ? 'seller_id' : query.role === 'PRINTER' ? 'printer_id' : null;
        const rows = [...this.requests.values()].filter(item => (!key || item[key] === query.actorId) && (!query.status || item.status === query.status)).sort((a,b) => b.created_at.getTime() - a.created_at.getTime());
        return { items: structuredClone(rows.slice((page - 1) * pageSize, page * pageSize)), total: rows.length, page, pageSize };
    }
    async findDetail(id: string): Promise<ReturnRequestV3Detail | null> {
        const request = await this.findById(id); if (!request) return null;
        return { request, timeline: await this.listLogs(id), evidence: await this.listEvidence(id) };
    }
    async findById(id: string): Promise<ReturnRequestV3Data | null> { const value = this.requests.get(id); return value ? structuredClone(value) : null; }
    async findActiveByItem(item: string): Promise<ReturnRequestV3Data | null> {
        const value = [...this.requests.values()].find(request => request.order_item_id === item && ACTIVE_STATUS_VALUES.has(request.status));
        return value ? structuredClone(value) : null;
    }
    async listActiveByOrder(orderId: string): Promise<ReturnRequestV3Data[]> { return [...this.requests.values()].filter(request => request.order_id === orderId && ACTIVE_STATUS_VALUES.has(request.status)).map(request => structuredClone(request)); }
    async transitionWithAudit(id: string, expectedVersion: number, patch: ReturnRequestV3Patch, log: ReturnRequestLogV3Data, evidence: ReturnEvidenceV3Data[] = []): Promise<ReturnRequestV3Data> {
        const current = this.requests.get(id);
        if (!current || current.version !== expectedVersion) throw new ReturnRequestV3ConflictError();
        assertImmutable(current,patch);
        const evidenceKeys=new Set<string>(); for(const item of evidence){const key=`${item.request_id}:${item.evidence_id}`;if(evidenceKeys.has(key)||this.evidence.some(existing=>existing.request_id===item.request_id&&existing.evidence_id===item.evidence_id))throw new ReturnRequestV3ConflictError('Duplicate evidence ID for request.');evidenceKeys.add(key);}
        const saved = { ...current, ...structuredClone(patch), version: current.version + 1, updated_at: patch.updated_at ?? current.updated_at };
        this.requests.set(id, saved); this.evidence.push(...structuredClone(evidence)); this.logs.push(structuredClone(log)); return structuredClone(saved);
    }
    async casTransition(id: string, expectedVersion: number, patch: ReturnRequestV3Patch, log:ReturnRequestLogV3Data): Promise<ReturnRequestV3Data> {
        const current = this.requests.get(id);
        if (!current || current.version !== expectedVersion) throw new ReturnRequestV3ConflictError();
        assertImmutable(current,patch);
        const saved = { ...current, ...structuredClone(patch), version: current.version + 1, updated_at: patch.updated_at ?? current.updated_at };
        this.requests.set(id, saved); this.logs.push(structuredClone(log)); return structuredClone(saved);
    }
    async appendEvidence(value: ReturnEvidenceV3Data): Promise<void> { if(this.evidence.some(item=>item.request_id===value.request_id&&item.evidence_id===value.evidence_id)) throw new ReturnRequestV3ConflictError('Duplicate evidence ID for request.'); this.evidence.push(structuredClone(value)); }
    async appendLog(value: ReturnRequestLogV3Data): Promise<void> { this.logs.push(structuredClone(value)); }
    async listEvidence(id: string): Promise<ReturnEvidenceV3Data[]> { return structuredClone(this.evidence.filter(item => item.request_id === id)); }
    async listLogs(id: string): Promise<ReturnRequestLogV3Data[]> { return structuredClone(this.logs.filter(item => item.request_id === id)); }
    async consumeOnce(item: string, requestId: string, at: Date): Promise<ExchangeQuotaResult> {
        if(!Number.isFinite(at.getTime())) throw new Error('Valid quota timestamp is required.');
        const existing = this.quotas.get(item); if (existing === requestId) return 'SAME_REQUEST'; if (existing) return 'CONFLICT'; this.quotas.set(item, requestId); return 'CONSUMED';
    }
}

export class MongoReturnRequestV3Repository implements ReturnRequestV3Repository, ReturnExchangeQuotaRepository {
    async finalizeExchangeWithAudit(id:string,version:number,item:string,requestId:string,at:Date,patch:ReturnRequestV3Patch,log:ReturnRequestLogV3Data):Promise<ReturnRequestV3Data>{
        const session=await mongoose.startSession(); let saved:ReturnRequestV3Data|null=null;
        try { await session.withTransaction(async()=>{
            const doc=await ReturnRequestV3.findOneAndUpdate({_id:id,version,final_resolution:'EXCHANGE',exchange_quota_consumed:false},{ $set:{...patch,exchange_quota_consumed:true},$inc:{version:1} },{new:true,runValidators:true,session}).lean();
            if(!doc) throw new ReturnRequestV3ConflictError();
            await ReturnExchangeQuotaV3.create([{order_item_id:item,request_id:requestId,consumed_at:at}],{session});
            await ReturnRequestLogV3.create([log],{session}); saved=asRequest(doc);
        }); } catch(error) { if(duplicateKey(error)) throw new ReturnRequestV3ConflictError('Exchange quota or request version conflict.'); throw error; }
        finally { await session.endSession(); }
        if(!saved) throw new ReturnRequestV3ConflictError(); return saved;
    }
    async create(request: ReturnRequestV3Data): Promise<ReturnRequestV3Data> {
        try { const { id, ...fields } = request; const doc = await ReturnRequestV3.create({ ...fields, _id: id }); return asRequest(doc.toObject()); }
        catch (error) { if (duplicateKey(error)) throw new ReturnRequestV3ConflictError(); throw error; }
    }
    async createWithAudit(request: ReturnRequestV3Data, evidence: ReturnEvidenceV3Data[], log: ReturnRequestLogV3Data): Promise<ReturnRequestV3Data> {
        const session = await mongoose.startSession(); let saved: ReturnRequestV3Data | null = null;
        try {
            await session.withTransaction(async () => {
                const { id, ...fields } = request;
                const [doc] = await ReturnRequestV3.create([{ ...fields, _id: id }], { session });
                if (evidence.length) await ReturnEvidenceV3.create(evidence, { session });
                await ReturnRequestLogV3.create([log], { session });
                saved = asRequest(doc.toObject());
            });
        } catch (error) { if (duplicateKey(error)) throw new ReturnRequestV3ConflictError(); throw error; }
        finally { await session.endSession(); }
        if (!saved) throw new Error('Failed to persist v3 request and audit in one transaction.');
        return saved;
    }
    async listByRole(query: ReturnRequestV3ListQuery): Promise<ReturnRequestV3ListResult> {
        const page = Math.max(1, Math.floor(query.page || 1)); const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize || 20)));
        const filter: Record<string, unknown> = query.role === 'ADMIN' ? {} : { [query.role === 'BUYER' ? 'buyer_id' : query.role === 'SELLER' ? 'seller_id' : 'printer_id']: query.actorId };
        if (query.status) filter.status = query.status;
        const [docs, total] = await Promise.all([
            ReturnRequestV3.find(filter).sort({ created_at: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
            ReturnRequestV3.countDocuments(filter),
        ]);
        return { items: docs.map(asRequest), total, page, pageSize };
    }
    async findDetail(id: string): Promise<ReturnRequestV3Detail | null> {
        const request = await this.findById(id); if (!request) return null;
        const [timeline, evidence] = await Promise.all([this.listLogs(id), this.listEvidence(id)]);
        return { request, timeline, evidence };
    }
    async findById(id: string): Promise<ReturnRequestV3Data | null> { const doc = await ReturnRequestV3.findById(id).lean(); return doc ? asRequest(doc) : null; }
    async findActiveByItem(item: string): Promise<ReturnRequestV3Data | null> { const doc = await ReturnRequestV3.findOne({ order_item_id: item, status: { $in: [...RETURN_REQUEST_V3_ACTIVE_STATUSES] } }).lean(); return doc ? asRequest(doc) : null; }
    async listActiveByOrder(orderId: string): Promise<ReturnRequestV3Data[]> { return (await ReturnRequestV3.find({ order_id: orderId, status: { $in: [...RETURN_REQUEST_V3_ACTIVE_STATUSES] } }).lean()).map(asRequest); }
    async transitionWithAudit(id: string, expectedVersion: number, patch: ReturnRequestV3Patch, log: ReturnRequestLogV3Data, evidence: ReturnEvidenceV3Data[] = []): Promise<ReturnRequestV3Data> {
        const session = await mongoose.startSession(); let saved: ReturnRequestV3Data | null = null;
        try {
            await session.withTransaction(async () => {
                const doc = await ReturnRequestV3.findOneAndUpdate({ _id: id, version: expectedVersion }, { $set: patch, $inc: { version: 1 } }, { new: true, runValidators: true, session }).lean();
                if (!doc) throw new ReturnRequestV3ConflictError();
                if (evidence.length) await ReturnEvidenceV3.create(evidence, { session });
                await ReturnRequestLogV3.create([log], { session }); saved = asRequest(doc);
            });
        } finally { await session.endSession(); }
        if (!saved) throw new ReturnRequestV3ConflictError(); return saved;
    }
    async casTransition(id: string, expectedVersion: number, patch: ReturnRequestV3Patch, log:ReturnRequestLogV3Data): Promise<ReturnRequestV3Data> { return this.transitionWithAudit(id,expectedVersion,patch,log); }
    async appendEvidence(value: ReturnEvidenceV3Data): Promise<void> { await ReturnEvidenceV3.create(value); }
    async appendLog(value: ReturnRequestLogV3Data): Promise<void> { await ReturnRequestLogV3.create(value); }
    async listEvidence(id: string): Promise<ReturnEvidenceV3Data[]> { return (await ReturnEvidenceV3.find({ request_id: id }).sort({ created_at: 1 }).lean()) as unknown as ReturnEvidenceV3Data[]; }
    async listLogs(id: string): Promise<ReturnRequestLogV3Data[]> { return (await ReturnRequestLogV3.find({ request_id: id }).sort({ created_at: 1 }).lean()) as unknown as ReturnRequestLogV3Data[]; }
    async consumeOnce(item: string, requestId: string, at: Date): Promise<ExchangeQuotaResult> {
        try { await ReturnExchangeQuotaV3.create({ order_item_id: item, request_id: requestId, consumed_at: at }); return 'CONSUMED'; }
        catch (error) { if (!duplicateKey(error)) throw error; const existing = await ReturnExchangeQuotaV3.findOne({ order_item_id: item }).lean() as { request_id?: string } | null; return existing?.request_id === requestId ? 'SAME_REQUEST' : 'CONFLICT'; }
    }
}

export function isMongoReturnRequestDuplicate(error: unknown): boolean { return duplicateKey(error) || error instanceof mongoose.mongo.MongoServerError && error.code === 11000; }
