import assert from 'node:assert/strict';
import test from 'node:test';
import { ReturnRequestApplicationService, type DeliveredEventSourceV3, type OrderReturnSnapshotSource, type ReturnRequestRefundBridge } from './return-request.service';
import { InMemoryReturnRequestV3Repository } from '../infrastructure/repositories/return-request-v3.repository';

const now = new Date('2026-05-02T00:00:00Z');
const delivered = { eventId: 'delivered-1', occurredAt: new Date('2026-05-01T00:00:00Z'), verified: true };
const snapshotSource: OrderReturnSnapshotSource = { async getSnapshot() { return { orderId: 'o1', orderItemId: 'i1', buyerId: 'b1', sellerId: 's1', printerId: 'p1', cohort: 'POD', itemStatus: 'DELIVERED' as const, itemSnapshot: { name:'shirt', size:'M', color:'blue', designVersion:'d1' }, valid: true, orderedQuantity: 2, replacedQuantity: 0, refundedQuantity: 0, activeReservedQuantity: 0, policyVersion: 'policy-v1', schemaVersion: 'v3' }; } };
const deliveredSource: DeliveredEventSourceV3 = { async getVerifiedDeliveredEvent() { return delivered; } };

function fixture() {
    let time = now.getTime(); let sequence = 0; const bridgeCalls: unknown[] = [];
    const clock = { now: () => new Date(time) };
    const repository = new InMemoryReturnRequestV3Repository();
    const bridge: ReturnRequestRefundBridge = { async createLinkedRefund(input) { bridgeCalls.push(input); return { id: 'linked-1', status: 'PENDING_INTEGRATION' }; } };
    const service = new ReturnRequestApplicationService({ repository, snapshotSource, deliveredEventSource: deliveredSource, bridge, clock, id: () => `id-${++sequence}` });
    const evidence = [{ id: 'e1', kind: 'IMAGE' as const, uri: 'blob://e1' }];
    return { service, repository, bridgeCalls, evidence, setTime(value: Date) { time = value.getTime(); } };
}

async function create(f: ReturnType<typeof fixture>, resolution: 'REFUND'|'EXCHANGE' = 'REFUND', reasonCode = 'R02') {
    return f.service.createBuyerRequest({ actorId: 'b1', orderId: 'o1', orderItemId: 'i1', quantity: 1, reasonCode, description: 'defect', resolution, evidence: f.evidence });
}

test('Buyer creation validates POD snapshot, delivered deadline, quantity and evidence, then logs initial state', async () => {
    const f = fixture(); const result = await create(f);
    assert.equal(result.status, 'PENDING_PRINTER'); assert.equal(result.deadline_type, 'P01');
    assert.equal((await f.repository.listEvidence(result.id)).length, 1);
    assert.equal((await f.repository.listLogs(result.id)).length, 1);
    await assert.rejects(f.service.createBuyerRequest({ actorId: 'intruder', orderId: 'o1', orderItemId: 'i2', quantity: 1, reasonCode: 'R02', description: 'x', resolution: 'REFUND', evidence: f.evidence }));
});

test('a Return v3 request created from a simulated order remains marked simulated', async () => {
    const f = fixture();
    const simulatedSnapshotSource = {
        async getSnapshot() { return { ...(await snapshotSource.getSnapshot('o1', 'i1'))!, is_simulated: true }; },
    } as unknown as OrderReturnSnapshotSource;
    const service = new ReturnRequestApplicationService({
        repository: f.repository, snapshotSource: simulatedSnapshotSource, deliveredEventSource: deliveredSource,
        bridge: f.service['deps'].bridge, clock: { now: () => now }, id: () => 'sim-return-1',
    });
    const request = await service.createBuyerRequest({ actorId: 'b1', orderId: 'o1', orderItemId: 'i1', quantity: 1, reasonCode: 'R02', description: 'simulated item', resolution: 'REFUND', evidence: f.evidence });
    assert.equal(request.is_simulated, true);
    assert.equal((await f.repository.findById(request.id))?.is_simulated, true);
});



test('reason mapping assigns documented defaults but holds R01a/R07 for Admin without using DPI as fault evidence', async () => {
    const f = fixture(); const ordinary = await create(f);
    assert.equal(ordinary.fault_party, 'PRINTER'); assert.equal(ordinary.fault_source, 'SYSTEM');
    const dpi = fixture(); const r01a = await create(dpi, 'REFUND', 'R01A');
    assert.equal(r01a.status, 'DISPUTED'); assert.equal(r01a.fault_party, null); assert.equal(r01a.fault_source, null);
    const r07 = await create(fixture(),'REFUND','R07'); assert.equal(r07.status,'DISPUTED'); assert.equal(r07.fault_party,null);
    const r08 = await create(fixture(),'REFUND','R08'); assert.equal(r08.status,'DISPUTED'); assert.equal(r08.fault_party,null);
});

test('R06 delivered uses its own 168-hour deadline and verified tracking fault source; missing source routes Admin', async () => {
    const f = fixture();
    const tracking = { status: 'DELIVERED' as const, eventId: 'tracking-delivered-1', eventOccurredAt: delivered.occurredAt, sourceAssigned: true, verified: true, latestEta: null, faultParty: 'CARRIER' as const };
    const service = new ReturnRequestApplicationService({ repository: f.repository, snapshotSource, deliveredEventSource: { ...deliveredSource, async getVerifiedTracking() { return tracking; } }, bridge: { async createLinkedRefund() { return { id:'linked', status:'PENDING_INTEGRATION' as const }; } }, clock: { now:()=>now }, id:()=> 'r06' });
    const request = await service.createBuyerRequest({ actorId:'b1',orderId:'o1',orderItemId:'i1',quantity:1,reasonCode:'R06',description:'not received',resolution:'REFUND',evidence:f.evidence });
    assert.equal(request.status,'PENDING_PRINTER'); assert.equal(request.deadline_type,'R06_DELIVERED'); assert.equal(request.deadline_at?.toISOString(),'2026-05-08T00:00:00.000Z'); assert.equal(request.fault_party,'CARRIER');
    const missing = fixture(); const review = await create(missing,'REFUND','R06'); assert.equal(review.status,'DISPUTED'); assert.equal(review.fault_party,null);
    const shipping = fixture(); const eligibleTracking = { status:'IN_TRANSIT' as const,eventId:'eta-check',eventOccurredAt:new Date('2026-04-20T00:00:00Z'),sourceAssigned:true,verified:true,latestEta:new Date('2026-04-20T00:00:00Z'),faultParty:'PRINTER' as const };
    const shippingService = new ReturnRequestApplicationService({ repository:shipping.repository, snapshotSource:{async getSnapshot(){return {...(await snapshotSource.getSnapshot('o1','i1'))!,itemStatus:'SHIPPING' as const};}}, deliveredEventSource:{...deliveredSource,async getVerifiedTracking(){return eligibleTracking;}}, bridge:{async createLinkedRefund(){return {id:'linked',status:'PENDING_INTEGRATION' as const};}}, clock:{now:()=>now}, id:()=> 'r06-shipping' });
    const shippingRequest=await shippingService.createBuyerRequest({actorId:'b1',orderId:'o1',orderItemId:'i1',quantity:1,reasonCode:'R06',description:'not received',resolution:'REFUND',evidence:shipping.evidence});
    assert.equal(shippingRequest.deadline_type,'P07'); assert.equal(shippingRequest.deadline_at,null); assert.equal(shippingRequest.fault_party,'PRINTER');
});

test('Printer ordinary approval cannot call Refund bridge; only Admin confirmation does', async () => {
    const f = fixture(); const created = await create(f);
    const approved = await f.service.printerDecision({ actorId: 'p1', requestId: created.id, action: 'APPROVE', reason: 'accepted' });
    assert.equal(approved.status, 'AWAITING_ADMIN_REFUND'); assert.equal(approved.refund_admin_confirmed, false); assert.equal(f.bridgeCalls.length, 0);
    await assert.rejects((f.service as any).createBridge(approved)); assert.equal(f.bridgeCalls.length, 0);
    const refunded=await f.service.adminConfirmRefund({ actorId: 'admin-1', requestId: created.id, amountMinor: 2500, currency: 'VND', faultParty: 'PRINTER' });
    assert.equal(f.bridgeCalls.length, 1);
    assert.equal(refunded.linked_refund_id,'linked-1');
    assert.equal((await f.repository.findById(created.id))?.refund_admin_confirmed, true);
});

test('development Admin-as-Printer audit preserves the real Admin id and acting_as marker', async () => {
    const f = fixture(); const created = await create(f, 'EXCHANGE');
    const previousEnv = { nodeEnv: process.env.NODE_ENV, simulation: process.env.ENABLE_DEV_ORDER_SIMULATION };
    process.env.NODE_ENV = 'development'; process.env.ENABLE_DEV_ORDER_SIMULATION = 'true';
    try {
        const updated = await f.service.printerDecision({ actorId: 'admin-1', devAdminActorId: 'admin-1', requestId: created.id, action: 'APPROVE', reason: 'development printer test' });
        assert.equal(updated.status, 'APPROVED');
        const audit = (await f.repository.listLogs(created.id)).at(-1);
        assert.equal(audit?.actor_id, 'admin-1'); assert.equal(audit?.actor_role, 'ADMIN'); assert.equal(audit?.acting_as, 'PRINTER');
    } finally {
        if (previousEnv.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv.nodeEnv;
        if (previousEnv.simulation === undefined) delete process.env.ENABLE_DEV_ORDER_SIMULATION; else process.env.ENABLE_DEV_ORDER_SIMULATION = previousEnv.simulation;
    }
});

test('Admin cannot act as Printer through the service while the dev gate is off', async () => {
    const f = fixture(); const created = await create(f, 'EXCHANGE');
    const previousEnv = { nodeEnv: process.env.NODE_ENV, simulation: process.env.ENABLE_DEV_ORDER_SIMULATION };
    delete process.env.NODE_ENV; delete process.env.ENABLE_DEV_ORDER_SIMULATION;
    try { await assert.rejects(f.service.printerDecision({ actorId: 'admin-1', devAdminActorId: 'admin-1', requestId: created.id, action: 'APPROVE', reason: 'should be blocked' })); }
    finally {
        if (previousEnv.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv.nodeEnv;
        if (previousEnv.simulation === undefined) delete process.env.ENABLE_DEV_ORDER_SIMULATION; else process.env.ENABLE_DEV_ORDER_SIMULATION = previousEnv.simulation;
    }
});

test('Admin selecting Refund in a dispute is the confirmation and calls bridge after decision', async () => {
    const f = fixture(); const created = await create(f);
    await f.service.printerDecision({ actorId: 'p1', requestId: created.id, action: 'REJECT', reason: 'rejected' });
    const disputed = await f.service.buyerDispute({ actorId: 'b1', requestId: created.id, reason: 'evidence review' });
    assert.equal(disputed.status, 'DISPUTED');
    const result = await f.service.adminDecide({ actorId: 'admin-1', requestId: created.id, resolution: 'REFUND', faultParty: 'PRINTER', reason: 'confirmed', amountMinor: 2500, currency: 'VND' });
    assert.equal(result.status, 'CONVERTED_TO_REFUND'); assert.equal(result.refund_admin_confirmed, true); assert.equal(f.bridgeCalls.length, 1);
});

test('Printer evidence request is one-time and exchange approval never creates replacement state', async () => {
    const f = fixture(); const created = await create(f, 'EXCHANGE');
    const requested = await f.service.printerDecision({ actorId: 'p1', requestId: created.id, action: 'REQUEST_EVIDENCE', reason: 'need detail' });
    assert.ok(requested.evidence_deadline_at);
    await assert.rejects(f.service.printerDecision({ actorId: 'p1', requestId: created.id, action: 'REQUEST_EVIDENCE', reason: 'again' }));
    const approved = await f.service.printerDecision({ actorId: 'p1', requestId: created.id, action: 'APPROVE', reason: 'accepted' });
    assert.equal(approved.status, 'APPROVED'); assert.equal(f.bridgeCalls.length, 0);
});

test('Admin fault assignment opens a one-time Seller appeal window with evidence and no second decision', async () => {
    const f=fixture(); const created=await create(f,'REFUND','R01A');
    const decided=await f.service.adminDecide({actorId:'admin-1',requestId:created.id,resolution:'REFUND',faultParty:'SELLER',reason:'DPI review',amountMinor:2500,currency:'VND'});
    assert.equal(decided.status,'CONVERTED_TO_REFUND'); assert.ok(decided.seller_appeal_deadline_at);
    const appealed=await f.service.sellerAppeal({actorId:'s1',requestId:created.id,reason:'contest fault',evidence:[{id:'e2',kind:'IMAGE',uri:'blob://e2'}]});
    assert.equal(appealed.status,'CONVERTED_TO_REFUND'); assert.equal(appealed.seller_appeal_used,true);
    assert.equal((await f.repository.listEvidence(created.id)).length,2);
    await assert.rejects(f.service.sellerAppeal({actorId:'s1',requestId:created.id,reason:'again'}));
});

test('Admin correction is one-time before bridge and transitions a rejected request to confirmed Refund', async () => {
    const f=fixture(); const created=await create(f); await f.service.printerDecision({actorId:'p1',requestId:created.id,action:'REJECT',reason:'disagree'});
    const corrected=await f.service.adminCorrect({actorId:'admin-1',requestId:created.id,reason:'reviewed evidence',resolution:'REFUND',faultParty:'PRINTER',amountMinor:2500,currency:'VND'});
    assert.equal(corrected.status,'CONVERTED_TO_REFUND'); assert.equal(corrected.correction_used,true); assert.equal(f.bridgeCalls.length,1);
    await assert.rejects(f.service.adminCorrect({actorId:'admin-1',requestId:created.id,reason:'again',resolution:'REFUND',faultParty:'PRINTER',amountMinor:2500,currency:'VND'}));
});

test('Printer P16 request gives Buyer one inclusive 24-hour evidence submission window', async () => {
    const f=fixture(); const created=await create(f,'EXCHANGE');
    await f.service.printerDecision({actorId:'p1',requestId:created.id,action:'REQUEST_EVIDENCE',reason:'need more evidence'});
    const submitted=await f.service.buyerAddEvidence({actorId:'b1',requestId:created.id,evidence:[{id:'e2',kind:'IMAGE',uri:'blob://e2'}]});
    assert.ok(submitted.buyer_evidence_submitted_at); assert.equal((await f.repository.listEvidence(created.id)).length,2);
    await assert.rejects(f.service.buyerAddEvidence({actorId:'b1',requestId:created.id,evidence:[{id:'e3',kind:'IMAGE',uri:'blob://e3'}]}));
    const expired=fixture(); const request=await create(expired,'EXCHANGE');
    await expired.service.printerDecision({actorId:'p1',requestId:request.id,action:'REQUEST_EVIDENCE',reason:'need more evidence'});
    expired.setTime(new Date('2026-05-03T00:00:00.001Z'));
    await assert.rejects(expired.service.buyerAddEvidence({actorId:'b1',requestId:request.id,evidence:[{id:'e4',kind:'IMAGE',uri:'blob://e4'}]}));
});

test('expired processing returns Admin reminder and does not auto-decide', async () => {
    const f = fixture(); const created = await create(f); f.setTime(new Date('2026-05-05T00:00:00Z'));
    const result = await f.service.processDeadline(created.id);
    assert.deepEqual(result, { kind: 'REMIND_ADMIN', requestId: created.id });
    assert.equal((await f.repository.findById(created.id))?.status, 'PENDING_PRINTER');
});
