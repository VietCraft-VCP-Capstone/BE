import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryReturnRequestV3Repository, ReturnRequestV3ConflictError, type ReturnRequestV3Data } from './return-request-v3.repository';

const record = (id: string): ReturnRequestV3Data => ({
    id, order_id: 'order-1', order_item_id: 'item-1', buyer_id: 'buyer-1', seller_id: 'seller-1', printer_id: 'printer-1', item_snapshot: { name:'sample', version:1 },
    quantity: 1, reason_code: 'R01', reason_description: 'defect', requested_resolution: 'REFUND', final_resolution: null,
    fault_party: null, fault_source: null, status: 'SUBMITTED', version: 0, deadline_at: new Date('2026-05-04T00:00:00Z'),
    deadline_type: 'P01', policy_version: 'pod-v1', schema_version: 'v3', delivered_event_id: 'delivered-1', delivered_at: new Date('2026-05-01T00:00:00Z'),
    refund_admin_confirmed: false, refund_admin_confirmed_by: null, refund_admin_confirmed_at: null, correction_used: false, side_effect_started: false,
    printer_evidence_request_used: false, buyer_dispute_count: 0, seller_appeal_used: false, exchange_quota_consumed: false, created_at: new Date('2026-05-01T00:00:00Z'), updated_at: new Date('2026-05-01T00:00:00Z'),
});

test('in-memory CAS accepts exactly one transition for the current version and increments version', async () => {
    const repository = new InMemoryReturnRequestV3Repository();
    await repository.create(record('request-1'));
    const results = await Promise.allSettled([
        repository.casTransition('request-1', 0, { status: 'PENDING_PRINTER' }, { request_id:'request-1', actor_id:'system', actor_role:'SYSTEM', from_status:'SUBMITTED', to_status:'PENDING_PRINTER', reason:'transition', event_id:null, created_at:new Date() }),
        repository.casTransition('request-1', 0, { status: 'DISPUTED' }, { request_id:'request-1', actor_id:'system', actor_role:'SYSTEM', from_status:'SUBMITTED', to_status:'DISPUTED', reason:'transition', event_id:null, created_at:new Date() }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.ok(failure.reason instanceof ReturnRequestV3ConflictError);
    assert.equal(failure.reason.statusCode, 409);
    const saved = await repository.findById('request-1');
    assert.equal(saved?.version, 1);
});

test('in-memory create enforces active-item uniqueness under concurrent calls', async () => {
    const repository=new InMemoryReturnRequestV3Repository();
    const results=await Promise.allSettled([repository.create(record('race-1')),repository.create(record('race-2'))]);
    assert.equal(results.filter(item=>item.status==='fulfilled').length,1);
    const rejected=results.find(item=>item.status==='rejected') as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof ReturnRequestV3ConflictError); assert.equal(rejected.reason.statusCode,409);
});

test('stale version conflicts with status 409 and item uniqueness is independent by item', async () => {
    const repository = new InMemoryReturnRequestV3Repository();
    await repository.create(record('request-1'));
    await repository.create({ ...record('request-2'), order_item_id: 'item-2' });
    await assert.rejects(repository.casTransition('request-1', 7, { status: 'PENDING_PRINTER' }, { request_id:'request-1', actor_id:'system', actor_role:'SYSTEM', from_status:'SUBMITTED', to_status:'PENDING_PRINTER', reason:'transition', event_id:null, created_at:new Date() }), (error: unknown) => error instanceof ReturnRequestV3ConflictError && error.statusCode === 409);
    await assert.rejects(repository.create({ ...record('request-3'), order_item_id: 'item-1' }), (error: unknown) => error instanceof ReturnRequestV3ConflictError && error.statusCode === 409);
});

test('exchange quota is consumed once with audited approval and cannot mark Replacement Created', async () => {
    const repository=new InMemoryReturnRequestV3Repository(); await repository.create(record('exchange-1'));
    await repository.casTransition('exchange-1',0,{status:'APPROVED',final_resolution:'EXCHANGE'},{request_id:'exchange-1',actor_id:'printer-1',actor_role:'PRINTER',from_status:'SUBMITTED',to_status:'APPROVED',reason:'approved',event_id:null,created_at:new Date()});
    const log={request_id:'exchange-1',actor_id:'admin-1',actor_role:'ADMIN' as const,from_status:'APPROVED',to_status:'APPROVED',reason:'quota recorded only',event_id:null,created_at:new Date()};
    const saved=await repository.finalizeExchangeWithAudit('exchange-1',1,'item-1','exchange-1',new Date(),{status:'APPROVED'},log);
    assert.equal(saved.exchange_quota_consumed,true); assert.equal(saved.status,'APPROVED');
    assert.equal(await repository.consumeOnce('item-1','exchange-1',new Date()),'SAME_REQUEST');
    await assert.rejects(repository.finalizeExchangeWithAudit('exchange-1',1,'item-1','exchange-1',new Date(),{status:'REPLACEMENT_CREATED'},log));
    assert.equal(await repository.consumeOnce('item-1','exchange-1',new Date()),'SAME_REQUEST');
    assert.equal(await repository.consumeOnce('item-1','exchange-2',new Date()),'CONFLICT');
});

test('evidence and transition audit logs are append-only repository operations', async () => {
    const repository = new InMemoryReturnRequestV3Repository();
    await repository.appendEvidence({ request_id: 'r1', evidence_id: 'e1', kind: 'PHOTO', storage_ref: 'blob:e1', uploaded_by: 'buyer-1', created_at: new Date() });
    await repository.appendLog({ request_id: 'r1', actor_id: 'buyer-1', actor_role: 'BUYER', from_status: null, to_status: 'SUBMITTED', reason: 'created', event_id: 'evt-1', created_at: new Date() });
    assert.equal((await repository.listEvidence('r1')).length, 1);
    assert.equal((await repository.listLogs('r1')).length, 1);
});

test('role list filters by actor and status, paginates, and detail includes timeline and evidence', async () => {
    const repository = new InMemoryReturnRequestV3Repository();
    await repository.createWithAudit(record('buyer-1-a'), [{ request_id: 'buyer-1-a', evidence_id: 'ev1', kind: 'PHOTO', storage_ref: 'blob:1', uploaded_by: 'buyer-1', created_at: new Date() }], { request_id: 'buyer-1-a', actor_id: 'buyer-1', actor_role: 'BUYER', from_status: null, to_status: 'SUBMITTED', reason: 'created', event_id: null, created_at: new Date() });
    await repository.create({ ...record('buyer-1-b'), order_item_id: 'item-2' });
    await repository.create({ ...record('buyer-2'), order_item_id: 'item-3', buyer_id: 'buyer-2', seller_id: 'seller-2', printer_id: 'printer-2', status: 'PENDING_PRINTER' });
    for (const query of [
        { role: 'BUYER' as const, actorId: 'buyer-1', expected: 2 },
        { role: 'SELLER' as const, actorId: 'seller-1', expected: 2 },
        { role: 'PRINTER' as const, actorId: 'printer-1', expected: 2 },
        { role: 'ADMIN' as const, actorId: 'admin-1', expected: 3 },
    ]) assert.equal((await repository.listByRole({ role: query.role, actorId: query.actorId, page: 1, pageSize: 10 })).total, query.expected);
    const buyerPage = await repository.listByRole({ role: 'BUYER', actorId: 'buyer-1', status: 'SUBMITTED', page: 2, pageSize: 1 });
    assert.equal(buyerPage.total, 2); assert.equal(buyerPage.items.length, 1); assert.equal(buyerPage.page, 2);
    const detail = await repository.findDetail('buyer-1-a');
    assert.equal(detail?.timeline.length, 1); assert.equal(detail?.evidence.length, 1);
});
