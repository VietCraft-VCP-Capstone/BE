import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import express from 'express';
import { createReturnRequestRouter } from './return-request.router';
import { createReturnClock } from '../application/return-request.runtime';
import { ReturnRequestApplicationService, type OrderReturnSnapshotSource, type ReturnRequestRefundBridge } from '../application/return-request.service';
import { InMemoryReturnRequestV3Repository } from '../infrastructure/repositories/return-request-v3.repository';

const now = new Date('2026-05-02T00:00:00Z');
const evidence = [{ id: 'e1', kind: 'IMAGE' as const, uri: '/uploads/refunds/e1.jpg' }];
function setup() {
    let seq = 0;
    const repository = new InMemoryReturnRequestV3Repository();
    const snapshotSource: OrderReturnSnapshotSource = { async getSnapshot(orderId, orderItemId) { return { orderId, orderItemId, buyerId:'buyer', sellerId:'seller', printerId:'printer', cohort:'POD', itemStatus:'DELIVERED', itemSnapshot:{ title:'POD item' }, valid:true, orderedQuantity:1, replacedQuantity:0, refundedQuantity:0, activeReservedQuantity:0, policyVersion:'v1', schemaVersion:'v3' }; } };
    const bridgeCalls: unknown[] = [];
    const bridge: ReturnRequestRefundBridge = { async createLinkedRefund(input) { bridgeCalls.push(input); return { id:'execution-1', status:'PENDING_INTEGRATION' }; } };
    const service = new ReturnRequestApplicationService({ repository, snapshotSource, deliveredEventSource:{ async getVerifiedDeliveredEvent(){ return { eventId:'delivered-1', occurredAt:new Date('2026-05-01T00:00:00Z'), verified:true }; } }, bridge, clock:{ now:()=>now }, id:()=>`req-${++seq}` });
    const app = express(); app.use(express.json());
    const auth: Parameters<typeof createReturnRequestRouter>[0]['authenticate'] = (req:any,_res,next) => { req.user = req.headers['x-user'] ? { id:String(req.headers['x-user']), role:String(req.headers['x-role'] || '') } : undefined; next(); };
    app.use('/returns/v3', createReturnRequestRouter({ service, authenticate:auth, clock:{ now:()=>now } }));
    const server = http.createServer(app);
    return { server, repository, bridgeCalls };
}
async function request(server: http.Server, method: string, path: string, role: string, user: string, body?: unknown) {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No HTTP server address');
    try {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers:{ 'content-type':'application/json', 'x-role':role, 'x-user':user }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) });
        const text=await response.text(); let responseBody:any; try { responseBody=JSON.parse(text); } catch { responseBody=text; }
        return { status:response.status, body:responseBody };
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
const createBody = { orderId:'order-1', orderItemId:'item-1', quantity:1, reasonCode:'R02', description:'item defect', resolution:'REFUND', evidence };

test('HTTP happy path: Buyer creates, assigned Printer approves Refund, Admin confirms and bridge is pending integration', async () => {
    const f=setup();
    const created=await request(f.server,'POST','/returns/v3/requests','buyer','buyer',createBody); assert.equal(created.status,201);
    const id=created.body.data.id;
    const printer=await request(f.server,'POST',`/returns/v3/requests/${id}/printer-decision`,'printer','printer',{action:'APPROVE',reason:'approved'}); assert.equal(printer.status,200); assert.equal(printer.body.data.status,'AWAITING_ADMIN_REFUND');
    const admin=await request(f.server,'POST',`/returns/v3/requests/${id}/admin/confirm-refund`,'admin','admin',{amountMinor:1200,currency:'VND',faultParty:'PRINTER'}); assert.equal(admin.status,200); assert.equal(admin.body.data.linked_refund_status,'PENDING_INTEGRATION'); assert.equal(f.bridgeCalls.length,1);
});

test('HTTP rejected request can be disputed and decided by Admin', async () => {
    const f=setup(); const created=await request(f.server,'POST','/returns/v3/requests','buyer','buyer',createBody); const id=created.body.data.id;
    assert.equal((await request(f.server,'POST',`/returns/v3/requests/${id}/printer-decision`,'printer','printer',{action:'REJECT',reason:'not covered'})).status,200);
    assert.equal((await request(f.server,'POST',`/returns/v3/requests/${id}/dispute`,'buyer','buyer',{reason:'please review'})).status,200);
    const result=await request(f.server,'POST',`/returns/v3/requests/${id}/admin/decision`,'admin','admin',{resolution:'REFUND',faultParty:'PRINTER',reason:'confirmed',amountMinor:1000,currency:'VND'}); assert.equal(result.status,200); assert.equal(result.body.data.linked_refund_status,'PENDING_INTEGRATION');
});

test('HTTP duplicate item request returns 409, evidence limit is enforced, and mismatched role returns 403', async () => {
    const f=setup(); const created=await request(f.server,'POST','/returns/v3/requests','buyer','buyer',createBody); assert.equal(created.status,201);
    assert.equal((await request(f.server,'POST','/returns/v3/requests','buyer','buyer',createBody)).status,409);
    assert.equal((await request(f.server,'POST',`/returns/v3/requests/${created.body.data.id}/evidence`,'buyer','buyer',{evidence:[1,2,3,4].map((_,i)=>({id:`e${i}`,kind:'IMAGE',uri:`/uploads/refunds/e${i}.jpg`}))})).status,400);
    assert.equal((await request(f.server,'POST','/returns/v3/requests','seller','seller',createBody)).status,403);
});

test('HTTP list/detail applies repository role scope to Buyer, Seller, Printer and Admin', async () => {
    const f=setup(); const created=await request(f.server,'POST','/returns/v3/requests','buyer','buyer',createBody); const id=created.body.data.id;
    for(const [role,user] of [['buyer','buyer'],['seller','seller'],['printer','printer'],['admin','admin']]) {
        assert.equal((await request(f.server,'GET','/returns/v3/requests',role,user)).status,200);
        const detail=await request(f.server,'GET',`/returns/v3/requests/${id}`,role,user); assert.equal(detail.status,200); assert.ok(Array.isArray(detail.body.data.timeline)); assert.ok(Array.isArray(detail.body.data.evidence));
    }
    assert.equal((await request(f.server,'GET',`/returns/v3/requests/${id}`,'buyer','intruder')).status,403);
});

test('development impersonation endpoint is absent when dev gates are off', async () => {
    const previous={node:process.env.NODE_ENV,flag:process.env.ENABLE_DEV_ORDER_SIMULATION}; delete process.env.NODE_ENV; delete process.env.ENABLE_DEV_ORDER_SIMULATION;
    try { const f=setup(); const result=await request(f.server,'POST','/returns/v3/requests/dev/printer-action','admin','admin',{requestId:'x',action:'APPROVE',reason:'test'}); assert.equal(result.status,404); }
    finally { if(previous.node===undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=previous.node; if(previous.flag===undefined) delete process.env.ENABLE_DEV_ORDER_SIMULATION; else process.env.ENABLE_DEV_ORDER_SIMULATION=previous.flag; }
});

test('clock offset has no effect when dev gate is off', async () => {
    const previous={node:process.env.NODE_ENV,flag:process.env.ENABLE_DEV_ORDER_SIMULATION,offset:process.env.DEV_CLOCK_OFFSET_HOURS}; delete process.env.NODE_ENV; delete process.env.ENABLE_DEV_ORDER_SIMULATION; process.env.DEV_CLOCK_OFFSET_HOURS='72';
    try { const f=setup(); const result=await request(f.server,'GET','/returns/v3/clock','buyer','buyer'); assert.equal(result.status,404); assert.equal(createReturnClock({now:()=>now}).now().getTime(),now.getTime()); assert.equal(createReturnClock({now:()=>now},{NODE_ENV:'development',ENABLE_DEV_ORDER_SIMULATION:'true',DEV_CLOCK_OFFSET_HOURS:'2'}).now().getTime(),now.getTime()+2*60*60*1000); }
    finally { if(previous.node===undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=previous.node; if(previous.flag===undefined) delete process.env.ENABLE_DEV_ORDER_SIMULATION; else process.env.ENABLE_DEV_ORDER_SIMULATION=previous.flag; if(previous.offset===undefined) delete process.env.DEV_CLOCK_OFFSET_HOURS; else process.env.DEV_CLOCK_OFFSET_HOURS=previous.offset; }
});
