import mongoose from 'mongoose';
import { canReturnActorPerform } from './return-actor-policy';
import { validateReturnEvidence, type ReturnEvidenceItem } from './return-evidence-policy';
import { calculateFixedDeadline, evaluateAnchoredWindow, evaluateP16EvidenceWindow, evaluatePodEligibility, inferDefaultFaultParty, type R06TrackingEvidence, type VerifiedDeliveredEvent } from './return-policy';
import { ReturnStateMachine, type ReturnAction, type ReturnActor, type ReturnState } from './return-state-machine';
import { validateRequestedQuantity } from './return-quantity-policy';
import type { ReturnRequestData, ReturnRequestPatch, ReturnRequestRepository, ReturnRequestLogData, ReturnEvidenceData, ReturnRequestListQuery, ReturnRequestDetail } from '../infrastructure/repositories/return-request.repository';
import type { ReturnRequestFaultParty, ReturnRequestResolution, ReturnRequestDeadlineType } from '../infrastructure/models/return-request.model';
import { Order } from '../infrastructure/models/order.model';
import { ReputationService } from '../../seller/application/reputation.service';

export interface ReturnDeliveredEventSource { getVerifiedDeliveredEvent(orderId: string, itemId: string): Promise<VerifiedDeliveredEvent | null>; getVerifiedTracking?(orderId:string,itemId:string):Promise<(R06TrackingEvidence & { faultParty?:'CARRIER'|'PRINTER' })|null> }
export interface OrderReturnSnapshotSource {
    getSnapshot(orderId: string, itemId: string): Promise<{ orderId:string; orderItemId:string; buyerId:string; sellerId:string; printerId:string; cohort:'POD'|'NORMAL'; itemStatus:'DELIVERED'|'SHIPPING'|'OTHER'; itemSnapshot:Record<string,unknown>; valid:boolean; orderedQuantity:number; replacedQuantity:number; refundedQuantity:number; activeReservedQuantity:number; policyVersion:string; schemaVersion:string; is_simulated?:boolean } | null>;
}
export interface ReturnRequestRefundBridge { /** Must be idempotent on requestId because retry may follow a timeout after remote create. */ createLinkedRefund(input: {requestId:string;orderItemId:string;orderId:string;resolution:'REFUND';faultParty:ReturnRequestFaultParty;amountMinor:number;currency:string;adminDecisionId:string;finalizedByAdmin:true}): Promise<{ id:string; status:string }> }
export interface ReturnRequestClock { now(): Date }
export interface ReturnEligibilityItemSource {
    getItems(orderId: string): Promise<Array<{ orderItemId?: string | null; buyerId:string; cohort:'POD'|'NORMAL'; itemStatus:'DELIVERED'|'SHIPPING'|'OTHER'; orderedQuantity:number; replacedQuantity:number; refundedQuantity:number; activeReservedQuantity:number }>>;
}
export interface ReturnEligibilityItem {
    orderItemId: string | null; eligible: boolean; reasonIfNot: { code:'NOT_DELIVERED'|'MISSING_ORDER_ITEM_ID'|'NORMAL_UNSUPPORTED'|'ACTIVE_REQUEST'|'EXPIRED'|'QUANTITY_EXHAUSTED'; label:string } | null;
    deadline: Date | null; remainingQuantity:number; activeRequestId?:string;
}
export interface ReturnRequestServiceDependencies {
    repository: ReturnRequestRepository; snapshotSource: OrderReturnSnapshotSource; deliveredEventSource: ReturnDeliveredEventSource;
    eligibilityItemSource?: ReturnEligibilityItemSource;
    resolveBuyerOrderId: (orderId: unknown, buyerId: string) => Promise<string>;
    bridge: ReturnRequestRefundBridge; executeRefund?: (request: ReturnRequestData) => Promise<{ id: string; status: string }>; clock: ReturnRequestClock; id: () => string; r06DeliveredWindowHours?: number;
}
export type PrinterDecisionAction = 'APPROVE'|'REJECT'|'REQUEST_EVIDENCE'|'PROPOSE_FAULT_CHANGE';
export type DeadlineOutcome = { kind:'REMIND_ADMIN'|'ADMIN_REVIEW'; requestId:string };

export class ReturnRequestApplicationService {
    constructor(private readonly deps: ReturnRequestServiceDependencies) {}
    private now(): Date { return this.deps.clock.now(); }
    private authorize(action: 'BUYER_VIEW'|'BUYER_SUBMIT'|'BUYER_ADD_EVIDENCE'|'BUYER_DISPUTE'|'SELLER_VIEW'|'SELLER_ADD_EVIDENCE'|'SELLER_APPEAL'|'PRINTER_VIEW'|'PRINTER_ADD_EVIDENCE'|'PRINTER_APPROVE'|'PRINTER_REJECT'|'PRINTER_REQUEST_EVIDENCE'|'PRINTER_PROPOSE_FAULT_CHANGE'|'ADMIN_FINALIZE'|'ADMIN_CORRECT', request: Pick<ReturnRequestData, 'buyer_id'|'seller_id'|'printer_id'|'fault_party'|'seller_appeal_used'|'correction_used'|'side_effect_started'>, actorId: string, role: ReturnActor): void {
        const decision = canReturnActorPerform(action, { actor:role, userId:actorId, orderOwnedByBuyer:role === 'BUYER' && actorId === request.buyer_id, sellerOwnsRequest:role === 'SELLER' && actorId === request.seller_id, assignedPrinter:role === 'PRINTER' && actorId === request.printer_id, faultSellerId:request.fault_party === 'SELLER' ? request.seller_id : null, appealUsed:request.seller_appeal_used, correctionCount:request.correction_used ? 1 : 0, sideEffectStarted:request.side_effect_started, scope:'POD' });
        if (!decision.allowed) throw new Error(decision.reason);
    }
    private async requireRequest(id: string): Promise<ReturnRequestData> {
        const request = await this.deps.repository.findById(id); if (!request) throw new Error('Return request not found.'); return request;
    }
    private async commit(current: ReturnRequestData, actorId: string, role: ReturnActor, action: ReturnAction, to: ReturnState, reason: string, patch: ReturnRequestPatch = {}, eventId: string | null = null, deadlineOverride?: Date, evidence:ReturnEvidenceData[] = [], auditRole: ReturnRequestLogData['actor_role'] = role, actingAs?: 'PRINTER'): Promise<ReturnRequestData> {
        ReturnStateMachine.assertTransition(current.status as ReturnState, action, to, { scope:'POD', actor:role, disputeCount:current.buyer_dispute_count, now:this.now(), deadline:deadlineOverride ?? current.deadline_at ?? undefined, sideEffectStarted:current.side_effect_started });
        const log: ReturnRequestLogData = { request_id:current.id, actor_id:actorId, actor_role:auditRole, ...(actingAs ? { acting_as:actingAs } : {}), from_status:current.status, to_status:to, reason, event_id:eventId, created_at:this.now() };
        return this.deps.repository.transitionWithAudit(current.id, current.version, { ...patch, updated_at:this.now(), status:to as ReturnRequestData['status'] }, log, evidence);
    }
    private async createBridge(request: ReturnRequestData): Promise<ReturnRequestData> {
        const faultParty=request.fault_party, amountMinor=request.refund_amount_minor, currency=request.refund_currency, adminDecisionId=request.admin_decision_id;
        if (request.final_resolution !== 'REFUND' || !request.refund_admin_confirmed || !faultParty || !adminDecisionId || amountMinor == null || !currency) throw new Error('Refund requires an Admin-confirmed decision before bridge execution.');
        if (request.linked_refund_id) return request.linked_refund_status === 'REFUNDED' ? request : this.executeLinkedRefund(request);
        if (!request.side_effect_started) {
            request = await this.deps.repository.transitionWithAudit(request.id, request.version, { side_effect_started:true, updated_at:this.now() }, { request_id:request.id, actor_id:'SYSTEM', actor_role:'SYSTEM', from_status:request.status, to_status:request.status, reason:'Admin-confirmed Refund bridge dispatch started.', event_id:adminDecisionId, created_at:this.now() });
        }
        const linked = await this.deps.bridge.createLinkedRefund({ requestId:request.id, orderItemId:request.order_item_id, orderId:request.order_id, resolution:'REFUND', faultParty, amountMinor, currency, adminDecisionId, finalizedByAdmin:true });
        const linkedRequest = await this.deps.repository.transitionWithAudit(request.id, request.version, { linked_refund_id:linked.id, linked_refund_status:linked.status, updated_at:this.now() }, { request_id:request.id, actor_id:'SYSTEM', actor_role:'SYSTEM', from_status:request.status, to_status:request.status, reason:'Persisted idempotent linked Refund bridge reference.', event_id:linked.id, created_at:this.now() });
        return this.executeLinkedRefund(linkedRequest);
    }
    /** Money moves only through the idempotent VNPay execution; the result is re-read so callers see the real status. */
    private async executeLinkedRefund(request: ReturnRequestData): Promise<ReturnRequestData> {
        if (!this.deps.executeRefund) return request;
        await this.deps.executeRefund(request);
        return (await this.deps.repository.findById(request.id)) ?? request;
    }
    async createBuyerRequest(input: { actorId:string; orderId:string; orderItemId:string; quantity:number; reasonCode:string; description:string; resolution:ReturnRequestResolution; evidence:readonly ReturnEvidenceItem[] }): Promise<ReturnRequestData> {
        const orderId = await this.deps.resolveBuyerOrderId(input.orderId, input.actorId);
        let snapshot = await this.deps.snapshotSource.getSnapshot(orderId, input.orderItemId);
        if (!snapshot || snapshot.orderId !== orderId || snapshot.orderItemId !== input.orderItemId || snapshot.buyerId !== input.actorId) throw Object.assign(new Error('Không tìm thấy đơn hàng.'),{statusCode:404});
        if (snapshot.cohort !== 'POD') throw new Error('POD cohort validation failed.');
        const normalizedInputReason=input.reasonCode.trim().toUpperCase();
        const now = this.now();
        if (snapshot.itemStatus !== 'DELIVERED' && normalizedInputReason !== 'R06') {
            if (snapshot.itemStatus === 'SHIPPING') {
                await Order.updateOne(
                    { _id: new mongoose.Types.ObjectId(orderId) },
                    {
                        $set: { order_status: 'DELIVERED', fulfillment_status: 'DELIVERED', 'printer_info.printer_status': 'DELIVERED' },
                        $push: { status_history: { status: 'DELIVERED', changed_at: now, note: 'Khách hàng tạo yêu cầu đổi/trả khi đang giao hàng (xác nhận đã nhận hàng).' } }
                    }
                );
                const updatedSnapshot = await this.deps.snapshotSource.getSnapshot(orderId, input.orderItemId);
                if (updatedSnapshot) snapshot = updatedSnapshot;
                (snapshot as any).itemStatus = 'DELIVERED';
            } else {
                throw new Error('Only Delivered items may create requests, except eligible R06 tracking cases.');
            }
        }
        if(normalizedInputReason==='R06' && snapshot.itemStatus!=='DELIVERED' && snapshot.itemStatus!=='SHIPPING') throw new Error('R06 not-received requests require Delivered or Shipping item status.');
        const evidenceCheck = validateReturnEvidence({ reasonCode:input.reasonCode, description:input.description, evidence:input.evidence });
        if (evidenceCheck.kind !== 'VALID') throw new Error(evidenceCheck.reason);
        const quantity = validateRequestedQuantity({ requested:input.quantity, ordered:snapshot.orderedQuantity, alreadyReplaced:snapshot.replacedQuantity, alreadyRefunded:snapshot.refundedQuantity, activeReserved:snapshot.activeReservedQuantity });
        if (quantity.kind !== 'VALID') throw new Error('Requested quantity exceeds remaining item quantity.');
        let delivered: VerifiedDeliveredEvent | null = null;
        try { delivered = await this.deps.deliveredEventSource.getVerifiedDeliveredEvent(orderId, input.orderItemId); } catch { /* Missing source evidence is routed to Admin review below. */ }
        if(snapshot.itemStatus==='SHIPPING') delivered=null;
        let r06Tracking:(R06TrackingEvidence & {faultParty?:'CARRIER'|'PRINTER'})|null=null;
        if(evidenceCheck.normalizedReason==='R06') { try { r06Tracking=await this.deps.deliveredEventSource.getVerifiedTracking?.(orderId,input.orderItemId) ?? null; } catch { r06Tracking=null; } }
        const eligibility = evaluatePodEligibility({ reasonCode:evidenceCheck.normalizedReason, now, deliveredEvent:delivered, r06Tracking:r06Tracking ?? undefined, r06DeliveredWindowHours:this.deps.r06DeliveredWindowHours });
        const conflict = !snapshot.valid;
        const standardDeadline = evidenceCheck.normalizedReason !== 'R06' && delivered?.verified === true && delivered.eventId.trim() ? calculateFixedDeadline('P01',delivered.occurredAt) : null;
        if (eligibility.kind === 'EXPIRED' || (standardDeadline && now.getTime() > standardDeadline.getTime())) throw new Error('Request deadline expired.');
        if (eligibility.kind === 'FEATURE_DISABLED' || eligibility.kind === 'INELIGIBLE') throw new Error('Request reason or feature is disabled.');
        const trackingTimeValid = r06Tracking?.eventOccurredAt instanceof Date && Number.isFinite(r06Tracking.eventOccurredAt.getTime()) && r06Tracking.eventOccurredAt.getTime() <= now.getTime();
        const deliveredEvidenceValid = delivered?.verified === true && !!delivered.eventId.trim() && delivered.occurredAt instanceof Date && Number.isFinite(delivered.occurredAt.getTime()) && delivered.occurredAt.getTime() <= now.getTime();
        const r06SourceConflict=evidenceCheck.normalizedReason==='R06' && !!r06Tracking && ((snapshot.itemStatus==='DELIVERED' && r06Tracking.status!=='DELIVERED') || (snapshot.itemStatus==='SHIPPING' && r06Tracking.status==='DELIVERED'));
        const needsAdminReview = eligibility.kind === 'ADMIN_REVIEW' || conflict || evidenceCheck.normalizedReason === 'R01A' || evidenceCheck.normalizedReason === 'R07' || (evidenceCheck.normalizedReason === 'R06' && ((snapshot.itemStatus==='DELIVERED' && (!deliveredEvidenceValid || !r06Tracking || r06Tracking.status!=='DELIVERED')) || r06SourceConflict || !r06Tracking?.verified || r06Tracking.conflicting === true || r06Tracking.status === 'UNKNOWN' || !r06Tracking.eventId?.trim() || !trackingTimeValid || !r06Tracking.sourceAssigned || !r06Tracking.faultParty));
        const allowedResolutions = { R01:['EXCHANGE','REFUND'], R01A:['REFUND'], R02:['EXCHANGE','REFUND'], R03:['EXCHANGE','REFUND'], R04:['EXCHANGE','REFUND'], R05:['EXCHANGE','REFUND'], R06:['REFUND'], R07:['REFUND'], R08:['REFUND'], R09:['REFUND'], R13:[] } as Record<string, readonly string[]>;
        if ((!needsAdminReview && eligibility.kind !== 'ELIGIBLE') || ((eligibility.kind === 'ELIGIBLE' || evidenceCheck.normalizedReason !== 'R99') && !allowedResolutions[evidenceCheck.normalizedReason]?.includes(input.resolution))) throw new Error('Request is expired, disabled, ineligible or resolution is not allowed.');
        const id = this.deps.id(); const status = needsAdminReview || (eligibility.kind === 'ELIGIBLE' && eligibility.adminReviewRequired) ? 'DISPUTED' : 'PENDING_PRINTER';
        const needsAdminFault = evidenceCheck.normalizedReason === 'R01A' || evidenceCheck.normalizedReason === 'R07' || evidenceCheck.normalizedReason === 'R99' || (evidenceCheck.normalizedReason === 'R06' && needsAdminReview);
        const defaultFault = needsAdminReview || needsAdminFault ? null : inferDefaultFaultParty(evidenceCheck.normalizedReason,{r06Source:r06Tracking?.faultParty ?? null,sourceVerified:r06Tracking?.verified && r06Tracking.sourceAssigned === true && r06Tracking.conflicting !== true});
        const deadline = eligibility.kind === 'ELIGIBLE' ? eligibility.deadline : evidenceCheck.normalizedReason === 'R06' || !deliveredEvidenceValid ? null : calculateFixedDeadline('P01',delivered!.occurredAt);
        const deadlineType = eligibility.kind === 'ELIGIBLE' ? eligibility.policyId : evidenceCheck.normalizedReason === 'R06' || !deliveredEvidenceValid ? null : 'P01';
        const request: ReturnRequestData = {
            id, order_id:orderId, order_item_id:input.orderItemId, buyer_id:snapshot.buyerId, seller_id:snapshot.sellerId, printer_id:snapshot.printerId, item_snapshot:structuredClone(snapshot.itemSnapshot),
            quantity:input.quantity, reason_code:evidenceCheck.normalizedReason, reason_description:evidenceCheck.normalizedDescription,
            requested_resolution:input.resolution, final_resolution:null, fault_party:defaultFault, fault_source:defaultFault ? 'SYSTEM' : null, status, version:0,
            deadline_at:deadline, deadline_type:deadlineType as ReturnRequestDeadlineType, policy_version:snapshot.policyVersion, schema_version:snapshot.schemaVersion,
            delivered_event_id:delivered?.eventId ?? null, delivered_at:delivered?.occurredAt ?? null, refund_admin_confirmed:false,
            refund_admin_confirmed_by:null, refund_admin_confirmed_at:null, correction_used:false, printer_evidence_request_used:false,
            buyer_dispute_count:0, seller_appeal_used:false, side_effect_started:false, exchange_quota_consumed:false,
            r06_tracking_event_id:evidenceCheck.normalizedReason==='R06'?r06Tracking?.eventId ?? null:null, r06_tracking_event_at:evidenceCheck.normalizedReason==='R06'?r06Tracking?.eventOccurredAt ?? null:null, r06_tracking_status:evidenceCheck.normalizedReason==='R06'?r06Tracking?.status ?? null:null, r06_tracking_latest_eta:evidenceCheck.normalizedReason==='R06'?r06Tracking?.latestEta ?? null:null, r06_fault_source:evidenceCheck.normalizedReason==='R06' && r06Tracking?.verified && r06Tracking.sourceAssigned && !r06Tracking.conflicting ? r06Tracking.faultParty ?? null:null,
            is_simulated:snapshot.is_simulated === true,
            created_at:now, updated_at:now,
        };
        const evidenceRows: ReturnEvidenceData[] = input.evidence.map(item => ({ request_id:id, evidence_id:item.id, kind:item.kind === 'IMAGE' ? 'PHOTO' : 'VIDEO', storage_ref:item.uri, uploaded_by:input.actorId, created_at:now }));
        const log: ReturnRequestLogData = { request_id:id, actor_id:input.actorId, actor_role:'BUYER', from_status:null, to_status:status, reason:'Buyer submitted POD return request.', event_id:null, created_at:now };
        return this.deps.repository.createWithAudit(request, evidenceRows, log);
    }
    async printerDecision(input: { actorId:string; requestId:string; action:PrinterDecisionAction; reason:string; proposedFault?:ReturnRequestFaultParty; proposedClassification?:string; evidence?:readonly ReturnEvidenceItem[]; devAdminActorId?:string }): Promise<ReturnRequestData> {
        const current = await this.requireRequest(input.requestId);
        const actorAction = input.action === 'APPROVE' ? 'PRINTER_APPROVE' : input.action === 'REJECT' ? 'PRINTER_REJECT' : input.action === 'REQUEST_EVIDENCE' ? 'PRINTER_REQUEST_EVIDENCE' : 'PRINTER_PROPOSE_FAULT_CHANGE';
        const devAdminActingAsPrinter = !!input.devAdminActorId && input.devAdminActorId === input.actorId && process.env.NODE_ENV === 'development' && process.env.ENABLE_DEV_ORDER_SIMULATION === 'true';
        if (devAdminActingAsPrinter) {
            if (!current.printer_id) throw new Error('Assigned Printer is required for development impersonation.');
        } else this.authorize(actorAction,current,input.actorId,'PRINTER');
        if (!input.reason.trim()) throw new Error('Decision reason is required.');
        if (!current.fault_party && current.reason_code === 'R06' && input.action === 'APPROVE') throw new Error('R06 fault assignment requires verified tracking evidence or Admin review.');
        if (current.reason_code === 'R01A' || current.reason_code === 'R07') { /* DPI evidence never sets fault; Admin resolves these cases. */ }
        const auditRole: ReturnRequestLogData['actor_role'] = devAdminActingAsPrinter ? 'ADMIN' : 'PRINTER';
        const actingAs = devAdminActingAsPrinter ? 'PRINTER' as const : undefined;
        if (input.action === 'REQUEST_EVIDENCE') {
            if (current.printer_evidence_request_used || current.status !== 'PENDING_PRINTER') throw new Error('Printer may request evidence only once while pending.');
            const requestedAt=this.now(); const window=evaluateP16EvidenceWindow({requestedAt,requestsAlreadyUsed:0,now:requestedAt});
            if(window.kind!=='ALLOWED') throw new Error('P16 evidence request cannot be opened.');
            const deadline=window.deadline;
            const updated = await this.deps.repository.transitionWithAudit(current.id,current.version,{ printer_evidence_request_used:true,evidence_requested_at:this.now(),evidence_deadline_at:deadline },{ request_id:current.id,actor_id:input.actorId,actor_role:auditRole,...(actingAs?{acting_as:actingAs}:{}),from_status:current.status,to_status:current.status,reason:input.reason,event_id:null,created_at:this.now() });
            return updated;
        }
        if (input.action === 'PROPOSE_FAULT_CHANGE') {
            if ((!input.proposedFault && !input.proposedClassification) || !input.evidence?.length) throw new Error('Printer proposal must include a fault/classification suggestion and evidence.');
            const rows=input.evidence.map(item=>({request_id:current.id,evidence_id:item.id,kind:item.kind==='IMAGE'?'PHOTO' as const:'VIDEO' as const,storage_ref:item.uri,uploaded_by:input.actorId,created_at:this.now()}));
            return this.commit(current,input.actorId,'PRINTER','PRINTER_PROPOSE_FAULT_CHANGE','PRINTER_PROPOSED_FAULT_CHANGE',input.reason,{ proposed_fault_party:input.proposedFault ?? null,proposed_classification:input.proposedClassification ?? null },null,undefined,rows,auditRole,actingAs);
        }
        const approve = input.action === 'APPROVE';
        const to: ReturnState = approve && current.requested_resolution === 'REFUND' ? 'AWAITING_ADMIN_REFUND' : approve ? 'APPROVED' : 'REJECTED';
        const evidenceRows = (input.evidence ?? []).map(item => ({
            request_id: current.id,
            evidence_id: item.id || ('ev_' + Math.random().toString(36).substring(2, 9)),
            kind: item.kind === 'IMAGE' ? 'PHOTO' as const : 'VIDEO' as const,
            storage_ref: item.uri,
            uploaded_by: input.actorId,
            created_at: this.now()
        }));
        return this.commit(current, input.actorId, 'PRINTER', approve ? 'PRINTER_APPROVE' : 'PRINTER_REJECT', to, input.reason, { final_resolution: current.requested_resolution }, null, undefined, evidenceRows, auditRole, actingAs);
    }
    async addEvidence(input:{actorId:string;requestId:string;role:'SELLER'|'PRINTER';evidence:readonly ReturnEvidenceItem[]}):Promise<ReturnRequestData>{
        const current=await this.requireRequest(input.requestId); const action=input.role==='SELLER'?'SELLER_ADD_EVIDENCE':'PRINTER_ADD_EVIDENCE'; this.authorize(action,current,input.actorId,input.role);
        const existing=await this.deps.repository.listEvidence(current.id);
        const all=[...existing.map(item=>({id:item.evidence_id,kind:item.kind==='PHOTO'?'IMAGE' as const:'VIDEO' as const,uri:item.storage_ref})),...input.evidence];
        const validated=validateReturnEvidence({reasonCode:current.reason_code,description:current.reason_description,evidence:all}); if(validated.kind!=='VALID') throw new Error(validated.reason);
        const rows=input.evidence.map(item=>({request_id:current.id,evidence_id:item.id,kind:item.kind==='IMAGE'?'PHOTO' as const:'VIDEO' as const,storage_ref:item.uri,uploaded_by:input.actorId,created_at:this.now()}));
        return this.deps.repository.transitionWithAudit(current.id,current.version,{updated_at:this.now()},{request_id:current.id,actor_id:input.actorId,actor_role:input.role,from_status:current.status,to_status:current.status,reason:`${input.role} added evidence references.`,event_id:null,created_at:this.now()},rows);
    }
    async buyerAddEvidence(input:{actorId:string;requestId:string;evidence:readonly ReturnEvidenceItem[]}):Promise<ReturnRequestData>{
        const current=await this.requireRequest(input.requestId); this.authorize('BUYER_ADD_EVIDENCE',current,input.actorId,'BUYER');
        if(current.status!=='PENDING_PRINTER'||!current.evidence_requested_at||!current.evidence_deadline_at||current.buyer_evidence_submitted_at) throw new Error('No open one-time P16 evidence request.');
        const window=evaluateP16EvidenceWindow({requestedAt:current.evidence_requested_at,requestsAlreadyUsed:0,now:this.now()});
        if(window.kind!=='ALLOWED'||window.deadline.getTime()!==current.evidence_deadline_at.getTime()) throw new Error('P16 evidence deadline expired or inconsistent.');
        const existing=await this.deps.repository.listEvidence(current.id);
        const all=[...existing.map(item=>({id:item.evidence_id,kind:item.kind==='PHOTO'?'IMAGE' as const:'VIDEO' as const,uri:item.storage_ref})),...input.evidence];
        const validated=validateReturnEvidence({reasonCode:current.reason_code,description:current.reason_description,evidence:all});
        if(validated.kind!=='VALID') throw new Error(validated.reason);
        const at=this.now(); const rows=input.evidence.map(item=>({request_id:current.id,evidence_id:item.id,kind:item.kind==='IMAGE'?'PHOTO' as const:'VIDEO' as const,storage_ref:item.uri,uploaded_by:input.actorId,created_at:at}));
        return this.deps.repository.transitionWithAudit(current.id,current.version,{buyer_evidence_submitted_at:at,updated_at:at},{request_id:current.id,actor_id:input.actorId,actor_role:'BUYER',from_status:current.status,to_status:current.status,reason:'Buyer submitted evidence requested under P16.',event_id:null,created_at:at},rows);
    }
    async buyerDispute(input:{actorId:string;requestId:string;reason:string;evidence?:readonly ReturnEvidenceItem[]}):Promise<ReturnRequestData> {
        const current=await this.requireRequest(input.requestId); this.authorize('BUYER_DISPUTE',current,input.actorId,'BUYER');
        if(!input.reason.trim()) throw new Error('Buyer dispute reason is required.');
        if(current.status!=='REJECTED') throw new Error('Buyer may dispute only a Printer-rejected request.');
        const window=evaluateAnchoredWindow('P04',current.updated_at,this.now()); if(window.kind!=='OPEN') throw new Error('Buyer dispute deadline expired or invalid.');
        const rows=(input.evidence ?? []).map(item=>({request_id:current.id,evidence_id:item.id,kind:item.kind==='IMAGE'?'PHOTO' as const:'VIDEO' as const,storage_ref:item.uri,uploaded_by:input.actorId,created_at:this.now()}));
        return this.commit(current,input.actorId,'BUYER','BUYER_DISPUTE','DISPUTED',input.reason,{buyer_dispute_count:current.buyer_dispute_count+1,deadline_at:window.deadline,deadline_type:'P04'},null,window.deadline,rows);
    }
    async sellerAppeal(input:{actorId:string;requestId:string;reason:string;evidence?:readonly ReturnEvidenceItem[]}):Promise<ReturnRequestData>{
        const current=await this.requireRequest(input.requestId); this.authorize('SELLER_APPEAL',current,input.actorId,'SELLER');
        if(current.fault_party!=='SELLER') throw new Error('Only the assigned-fault Seller may appeal.');
        let appealDeadline=current.seller_appeal_deadline_at ?? null;
        if(!appealDeadline && current.seller_fault_notified_at) { const window=evaluateAnchoredWindow('P05',current.seller_fault_notified_at,this.now()); if(window.kind==='OPEN') appealDeadline=window.deadline; }
        if(!appealDeadline || this.now().getTime()>appealDeadline.getTime()) throw new Error('Seller appeal deadline expired or missing; Admin review required.');
        if(!input.reason.trim()) throw new Error('Seller appeal reason is required.');
        const rows=(input.evidence ?? []).map(item=>({request_id:current.id,evidence_id:item.id,kind:item.kind==='IMAGE'?'PHOTO' as const:'VIDEO' as const,storage_ref:item.uri,uploaded_by:input.actorId,created_at:this.now()}));
        return this.deps.repository.transitionWithAudit(current.id,current.version,{seller_appeal_used:true,updated_at:this.now()},{request_id:current.id,actor_id:input.actorId,actor_role:'SELLER',from_status:current.status,to_status:current.status,reason:input.reason,event_id:null,created_at:this.now()},rows);
    }
    async adminDecide(input:{actorId:string;requestId:string;resolution:ReturnRequestResolution|null;faultParty:ReturnRequestFaultParty|null;reason:string;amountMinor?:number;currency?:string}):Promise<ReturnRequestData>{
        const current=await this.requireRequest(input.requestId); if(!input.reason.trim()) throw new Error('Admin decision reason is required.');
        if(input.resolution && !input.faultParty) throw new Error('Admin must decide a fault party alongside any resolution.');
        if(input.resolution==='REFUND'&&(!Number.isSafeInteger(input.amountMinor)||input.amountMinor!<0||!input.currency)) throw new Error('Refund decision requires a valid amount/currency.');
        const sellerFault=input.faultParty==='SELLER'; const sellerNotifiedAt=sellerFault?this.now():null; const sellerWindow=sellerNotifiedAt?evaluateAnchoredWindow('P05',sellerNotifiedAt,this.now()):null;
        const acceptedPrinterProposal=current.status==='PRINTER_PROPOSED_FAULT_CHANGE'&&current.proposed_fault_party===input.faultParty;
        const base={final_resolution:input.resolution,fault_party:input.faultParty,fault_source:acceptedPrinterProposal?'PRINTER_PROPOSED':'ADMIN',admin_decision_id:this.deps.id(),refund_admin_confirmed:input.resolution==='REFUND',refund_admin_confirmed_by:input.resolution==='REFUND'?input.actorId:null,refund_admin_confirmed_at:input.resolution==='REFUND'?this.now():null,refund_amount_minor:input.resolution==='REFUND'?input.amountMinor:null,refund_currency:input.resolution==='REFUND'?input.currency:null,seller_fault_notified_at:sellerNotifiedAt,seller_appeal_deadline_at:sellerWindow?.kind==='OPEN'?sellerWindow.deadline:null};
        const action:ReturnAction=input.resolution==='REFUND'?'ADMIN_CONFIRM_REFUND':input.resolution==='EXCHANGE'?(current.status==='PRINTER_PROPOSED_FAULT_CHANGE'?'ADMIN_CONFIRM_FAULT_CHANGE':'ADMIN_APPROVE'):'ADMIN_REJECT';
        const to:ReturnState=input.resolution==='REFUND'?'CONVERTED_TO_REFUND':input.resolution==='EXCHANGE'?'APPROVED':'ADMIN_REJECTED';
        this.authorize('ADMIN_FINALIZE',current,input.actorId,'ADMIN');
        const saved=await this.commit(current,input.actorId,'ADMIN',action,to,input.reason,base);
        if (input.faultParty === 'SELLER' && current.seller_id) {
            void ReputationService.deductBySellerOrShop(current.seller_id, 10, 'Lỗi người bán trong giải quyết tranh chấp (Admin phân xử)', 'DISPUTE', current.id, { id: input.actorId, role: 'ADMIN' });
        }
        if(input.resolution==='REFUND') return this.createBridge(saved); return saved;
    }
    async adminConfirmRefund(input:{actorId:string;requestId:string;amountMinor:number;currency:string;faultParty:ReturnRequestFaultParty}):Promise<ReturnRequestData>{
        const current=await this.requireRequest(input.requestId);
        this.authorize('ADMIN_FINALIZE',current,input.actorId,'ADMIN');
        if(current.refund_admin_confirmed) return this.createBridge(current);
        if(current.final_resolution!=='REFUND'&&current.requested_resolution!=='REFUND') throw new Error('Only a Refund resolution can be confirmed.');
        if(!input.faultParty||!Number.isSafeInteger(input.amountMinor)||input.amountMinor<0||!input.currency.trim()) throw new Error('Admin confirmation requires verified fault and a valid Refund amount/currency.');
        const action:ReturnAction=current.status==='DISPUTED'?'ADMIN_CONFIRM_REFUND':'ADMIN_CONFIRM_REFUND';
        const saved=await this.commit(current,input.actorId,'ADMIN',action,'CONVERTED_TO_REFUND','Admin confirmed Refund before bridge.',{final_resolution:'REFUND',fault_party:input.faultParty,fault_source:'ADMIN',refund_admin_confirmed:true,refund_admin_confirmed_by:input.actorId,refund_admin_confirmed_at:this.now(),refund_amount_minor:input.amountMinor,refund_currency:input.currency,admin_decision_id:this.deps.id()});
        if (input.faultParty === 'SELLER' && current.seller_id) {
            void ReputationService.deductBySellerOrShop(current.seller_id, 10, 'Lỗi người bán trong giải quyết tranh chấp (Admin phân xử)', 'DISPUTE', current.id, { id: input.actorId, role: 'ADMIN' });
        }
        return this.createBridge(saved);
    }
    async adminCorrect(input:{actorId:string;requestId:string;reason:string;resolution:ReturnRequestResolution;faultParty:ReturnRequestFaultParty|null;amountMinor?:number;currency?:string}):Promise<ReturnRequestData>{
        const current=await this.requireRequest(input.requestId); this.authorize('ADMIN_CORRECT',current,input.actorId,'ADMIN');
        if(current.correction_used||current.side_effect_started) throw new Error('Correction is limited to once before side effect.');
        if(!input.reason.trim()||!input.faultParty) throw new Error('Admin correction requires a reason and fault party.');
        if(input.resolution==='REFUND'&&(!Number.isSafeInteger(input.amountMinor)||input.amountMinor!<0||!input.currency)) throw new Error('Refund correction needs confirmed amount/currency.');
        const action:ReturnAction=input.resolution==='REFUND'?'ADMIN_CORRECT_REFUND':'ADMIN_CORRECT_EXCHANGE';
        const to:ReturnState=input.resolution==='REFUND'?'CONVERTED_TO_REFUND':'APPROVED';
        const decisionId=this.deps.id(); const notifiedAt=input.faultParty==='SELLER'?this.now():null; const appealWindow=notifiedAt?evaluateAnchoredWindow('P05',notifiedAt,this.now()):null;
        const saved=await this.commit(current,input.actorId,'ADMIN',action,to,input.reason,{correction_used:true,final_resolution:input.resolution,fault_party:input.faultParty,fault_source:'ADMIN',admin_decision_id:decisionId,refund_admin_confirmed:input.resolution==='REFUND',refund_admin_confirmed_by:input.resolution==='REFUND'?input.actorId:null,refund_admin_confirmed_at:input.resolution==='REFUND'?this.now():null,refund_amount_minor:input.resolution==='REFUND'?input.amountMinor:null,refund_currency:input.resolution==='REFUND'?input.currency:null,seller_fault_notified_at:notifiedAt,seller_appeal_deadline_at:appealWindow?.kind==='OPEN'?appealWindow.deadline:null});
        if(input.resolution==='REFUND') return this.createBridge(saved); return saved;
    }
    async evaluateBuyerEligibility(actorId:string, orderIdInput:unknown):Promise<ReturnEligibilityItem[]> {
        const orderId=await this.deps.resolveBuyerOrderId(orderIdInput,actorId);
        if(!this.deps.eligibilityItemSource) throw new Error('Buyer eligibility source is not configured.');
        const rows=await this.deps.eligibilityItemSource.getItems(orderId);
        const [activeRequests, snapshots]=await Promise.all([this.deps.repository.listActiveByOrder(orderId),Promise.all(rows.map(row=>row.orderItemId ? this.deps.snapshotSource.getSnapshot(orderId,row.orderItemId) : Promise.resolve(null)))]);
        if(!rows.length || rows.some(row=>row.buyerId!==actorId)) throw Object.assign(new Error('Không tìm thấy đơn hàng.'),{statusCode:404});
        if(snapshots.some((snapshot,index)=>!!rows[index].orderItemId&&(!snapshot||snapshot.buyerId!==actorId||snapshot.orderId!==orderId))) throw Object.assign(new Error('Không tìm thấy đơn hàng.'),{statusCode:404});
        return Promise.all(rows.map(async(row,index)=>{
            const itemId=row.orderItemId || null; const snapshot=snapshots[index]; const active=itemId ? activeRequests.find(request=>request.order_item_id===itemId) : undefined;
            const remaining=Math.max(0,row.orderedQuantity-row.replacedQuantity-row.refundedQuantity-row.activeReservedQuantity);
            let deadline:Date|null=null;
            if (itemId && (row.itemStatus === 'DELIVERED' || row.itemStatus === 'SHIPPING') && row.cohort === 'POD') {
                try { const delivered=await this.deps.deliveredEventSource.getVerifiedDeliveredEvent(orderId,itemId); const result=evaluatePodEligibility({reasonCode:'R02',now:this.now(),deliveredEvent:delivered,r06DeliveredWindowHours:this.deps.r06DeliveredWindowHours}); if(result.kind==='ELIGIBLE'||result.kind==='EXPIRED') deadline=result.deadline; } catch { deadline=null; }
            }
            let reasonIfNot:ReturnEligibilityItem['reasonIfNot']=null;
            if(!itemId) reasonIfNot={code:'MISSING_ORDER_ITEM_ID',label:'Thiếu mã sản phẩm trong đơn'};
            else if(row.cohort==='NORMAL') reasonIfNot={code:'NORMAL_UNSUPPORTED',label:'Sản phẩm thường chưa hỗ trợ đổi/trả trực tuyến'};
            else if(active) reasonIfNot={code:'ACTIVE_REQUEST',label:'Đã có yêu cầu đang xử lý'};
            else if(remaining<=0) reasonIfNot={code:'QUANTITY_EXHAUSTED',label:'Đã dùng hết số lượng'};
            else if (row.itemStatus !== 'DELIVERED' && row.itemStatus !== 'SHIPPING') reasonIfNot = { code: 'NOT_DELIVERED', label: 'Đơn hàng chưa giao' };
            else if (row.itemStatus === 'DELIVERED') {
                const delivered=itemId ? await this.deps.deliveredEventSource.getVerifiedDeliveredEvent(orderId,itemId).catch(()=>null) : null;
                const policy=evaluatePodEligibility({reasonCode:'R02',now:this.now(),deliveredEvent:delivered,r06DeliveredWindowHours:this.deps.r06DeliveredWindowHours});
                if(policy.kind==='EXPIRED') reasonIfNot={code:'EXPIRED',label:'Đã quá hạn gửi yêu cầu'};
                else if(policy.kind!=='ELIGIBLE') reasonIfNot={code:'NOT_DELIVERED',label:'Chưa có dữ liệu giao hàng hợp lệ'};
            }
            return {orderItemId:itemId,eligible:!reasonIfNot,reasonIfNot,deadline:deadline&&Number.isFinite(deadline.getTime())?deadline:null,remainingQuantity:remaining,...(active?{activeRequestId:active.id}:{})};
        }));
    }
    async listRequests(query: ReturnRequestListQuery) { return this.deps.repository.listByRole(query); }
    async getRequestDetail(actorId: string, role: ReturnActor, requestId: string): Promise<ReturnRequestDetail | null> {
        const detail = await this.deps.repository.findDetail(requestId); if (!detail) return null;
        const request = detail.request;
        const allowed = role === 'ADMIN' || role === 'BUYER' && request.buyer_id === actorId || role === 'SELLER' && request.seller_id === actorId || role === 'PRINTER' && request.printer_id === actorId;
        if (!allowed) throw new Error('Actor cannot view this Return request.');
        return detail;
    }
    async processDeadline(requestId:string):Promise<DeadlineOutcome>{
        const current=await this.requireRequest(requestId); if(!current.deadline_at||this.now().getTime()<=current.deadline_at.getTime()) return {kind:'ADMIN_REVIEW',requestId};
        await this.deps.repository.appendLog({request_id:current.id,actor_id:'SYSTEM',actor_role:'SYSTEM',from_status:current.status,to_status:current.status,reason:'Deadline expired; notify Admin, no automatic decision.',event_id:null,created_at:this.now()});
        return {kind:'REMIND_ADMIN',requestId};
    }
}
