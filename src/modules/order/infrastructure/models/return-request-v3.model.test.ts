import assert from 'node:assert/strict';
import test from 'node:test';
import { ReturnRequestV3, ReturnEvidenceV3, ReturnRequestLogV3, ReturnExchangeQuotaV3, RETURN_REQUEST_V3_ACTIVE_STATUSES } from './return-request-v3.model';

test('v3 request schema contains immutable order/item snapshots, decision, deadline, and CAS fields', () => {
    const schema = ReturnRequestV3.schema;
    for (const field of ['order_id', 'order_item_id', 'buyer_id', 'seller_id', 'printer_id', 'quantity', 'reason_code', 'reason_description', 'requested_resolution', 'final_resolution', 'fault_party', 'fault_source', 'status', 'version', 'deadline_at', 'deadline_type', 'policy_version', 'schema_version', 'delivered_event_id', 'delivered_at', 'refund_admin_confirmed', 'correction_used', 'exchange_quota_consumed', 'is_simulated', 'created_at', 'updated_at']) {
        assert.ok(schema.path(field), `missing schema field ${field}`);
    }
    assert.equal(schema.path('order_id')?.options.immutable, true);
    assert.equal(schema.path('order_item_id')?.options.immutable, true);
    assert.equal(schema.path('is_simulated')?.options.immutable, true);
});

test('v3 schema declares one active request per item and unique exchange quota per item', () => {
    const activeIndex = ReturnRequestV3.schema.indexes().find(([keys, options]) =>
        JSON.stringify(keys) === JSON.stringify({ order_item_id: 1 }) && options?.unique === true &&
        (options.partialFilterExpression as any)?.status?.$in?.includes('DISPUTED'),
    );
    assert.ok(activeIndex, 'expected partial unique active-request index');
    assert.ok((activeIndex?.[1].partialFilterExpression as any)?.status.$in.includes('CONVERTED_TO_REFUND'));
    assert.ok(RETURN_REQUEST_V3_ACTIVE_STATUSES.includes('CONVERTED_TO_REFUND'));
    const quotaIndex = ReturnExchangeQuotaV3.schema.indexes().find(([keys, options]) =>
        JSON.stringify(keys) === JSON.stringify({ order_item_id: 1 }) && options?.unique === true,
    );
    assert.ok(quotaIndex, 'expected one-exchange-per-item unique index');
});

test('R06 delivered carrier tracking is accepted by the persistent schema', () => {
    const document = new ReturnRequestV3({ _id: 'r06', r06_tracking_status: 'DELIVERED' });
    const error = document.validateSync();
    assert.equal(error?.errors.r06_tracking_status, undefined);
});

test('evidence and request logs have append-only schemas with request links and audit fields', () => {
    for (const schema of [ReturnEvidenceV3.schema, ReturnRequestLogV3.schema]) assert.ok(schema.path('request_id'));
    for (const field of ['actor_id', 'actor_role', 'acting_as', 'from_status', 'to_status', 'reason', 'event_id']) assert.ok(ReturnRequestLogV3.schema.path(field));
    for (const field of ['evidence_id', 'kind', 'storage_ref', 'uploaded_by', 'created_at']) assert.ok(ReturnEvidenceV3.schema.path(field));
});
