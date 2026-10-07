import assert from 'node:assert/strict';
import test from 'node:test';
import { ReturnRefundExecution } from './return-refund-execution.model';

test('linked refund schema enforces the unique request/item business key', () => {
    const compound = ReturnRefundExecution.schema.indexes().find(([keys, options]) =>
        JSON.stringify(keys) === JSON.stringify({ request_id: 1, order_item_id: 1 }) && options?.unique === true,
    );
    assert.ok(compound);
});

test('linked refund schema exposes the execution lifecycle statuses', () => {
    const statusPath = ReturnRefundExecution.schema.path('status') as { enumValues?: string[] };
    assert.deepEqual(statusPath.enumValues, ['PENDING_INTEGRATION', 'PROCESSING', 'PENDING', 'FAILED', 'REFUNDED']);
    assert.equal(ReturnRefundExecution.schema.path('resolution') != null, true);
    assert.equal(ReturnRefundExecution.schema.path('fault_party') != null, true);
    assert.equal(ReturnRefundExecution.schema.path('amount_minor') != null, true);
    assert.equal(ReturnRefundExecution.schema.path('admin_decision_id') != null, true);
});
