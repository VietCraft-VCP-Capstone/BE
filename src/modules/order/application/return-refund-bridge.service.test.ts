import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createLinkedRefundExecution,
    type LinkedRefundExecution,
    type LinkedRefundExecutionRepository,
    type LinkedRefundInput,
} from './return-refund-bridge.service';

class DuplicateKeyError extends Error { code = 11000; }

class MemoryLinkedExecutionRepository implements LinkedRefundExecutionRepository {
    readonly records = new Map<string, LinkedRefundExecution>();
    sequence = 0;
    private key(requestId: string, orderItemId: string) { return `${requestId}:${orderItemId}`; }
    async findByBusinessKey(requestId: string, orderItemId: string) {
        return this.records.get(this.key(requestId, orderItemId)) ?? null;
    }
    async createPending(input: LinkedRefundInput): Promise<LinkedRefundExecution> {
        const key = this.key(input.requestId, input.orderItemId);
        if (this.records.has(key)) throw new DuplicateKeyError('unique business key');
        const record: LinkedRefundExecution = {
            id: `linked-${++this.sequence}`,
            requestId: input.requestId,
            orderItemId: input.orderItemId,
            orderId: input.orderId,
            resolution: 'REFUND',
            faultParty: input.faultParty!,
            amountMinor: input.amountMinor,
            currency: input.currency,
            adminDecisionId: input.adminDecisionId,
            status: 'PENDING_INTEGRATION',
        };
        this.records.set(key, record);
        return record;
    }
}

const input = (overrides: Partial<LinkedRefundInput> = {}): LinkedRefundInput => ({
    requestId: 'return-1', orderItemId: 'item-1', orderId: 'order-1', resolution: 'REFUND',
    faultParty: 'PRINTER', amountMinor: 2599, currency: 'VND', adminDecisionId: 'decision-1',
    finalizedByAdmin: true, ...overrides,
});

test('creates only a PENDING_INTEGRATION linked refund and preserves decision/fault/amount/source', async () => {
    const repository = new MemoryLinkedExecutionRepository();
    const result = await createLinkedRefundExecution(repository, input());
    assert.equal(result.status, 'PENDING_INTEGRATION');
    assert.equal(result.resolution, 'REFUND');
    assert.equal(result.faultParty, 'PRINTER');
    assert.equal(result.amountMinor, 2599);
    assert.equal(result.requestId, 'return-1');
    assert.equal(result.orderItemId, 'item-1');
    assert.equal(result.orderId, 'order-1');
    assert.equal(result.adminDecisionId, 'decision-1');
    assert.equal('finalizedByAdmin' in result, false);
});

test('same request and item returns the original record without mutation or duplicate creation', async () => {
    const repository = new MemoryLinkedExecutionRepository();
    const first = await createLinkedRefundExecution(repository, input());
    const retry = await createLinkedRefundExecution(repository, input({ amountMinor: 9000, faultParty: 'BUYER', adminDecisionId: 'other-decision' }));
    assert.equal(retry.id, first.id);
    assert.equal(retry.amountMinor, 2599);
    assert.equal(retry.faultParty, 'PRINTER');
    assert.equal(repository.records.size, 1);
});

test('same business key stays idempotent even if retry payload is stale or malformed', async () => {
    const repository = new MemoryLinkedExecutionRepository();
    const first = await createLinkedRefundExecution(repository, input());
    const retry = await createLinkedRefundExecution(repository, input({ finalizedByAdmin: false, resolution: 'EXCHANGE', amountMinor: -1 }));
    assert.equal(retry.id, first.id);
    assert.equal(retry.status, 'PENDING_INTEGRATION');
    assert.equal(repository.records.size, 1);
});

test('concurrent same-key creation handles unique-index race by reading existing record', async () => {
    const repository = new MemoryLinkedExecutionRepository();
    const [left, right] = await Promise.all([
        createLinkedRefundExecution(repository, input()),
        createLinkedRefundExecution(repository, input()),
    ]);
    assert.equal(left.id, right.id);
    assert.equal(repository.records.size, 1);
});

test('different order items have independent business keys', async () => {
    const repository = new MemoryLinkedExecutionRepository();
    const first = await createLinkedRefundExecution(repository, input());
    const second = await createLinkedRefundExecution(repository, input({ orderItemId: 'item-2' }));
    assert.notEqual(first.id, second.id);
    assert.equal(repository.records.size, 2);
});

test('rejects missing Admin-finalized Refund decision, unknown fault or invalid amount', async () => {
    const repository = new MemoryLinkedExecutionRepository();
    await assert.rejects(createLinkedRefundExecution(repository, input({ finalizedByAdmin: false })), /Admin/i);
    await assert.rejects(createLinkedRefundExecution(repository, input({ resolution: 'EXCHANGE' })), /Refund/i);
    await assert.rejects(createLinkedRefundExecution(repository, input({ faultParty: null })), /fault/i);
    await assert.rejects(createLinkedRefundExecution(repository, input({ amountMinor: -1 })), /tiền Refund/i);
    assert.equal(repository.records.size, 0);
});

test('repository does not expose a transition to paid/refunded/failed', async () => {
    const repository = new MemoryLinkedExecutionRepository();
    const result = await createLinkedRefundExecution(repository, input());
    assert.deepEqual(Object.keys(result).sort(), ['adminDecisionId', 'amountMinor', 'currency', 'faultParty', 'id', 'orderId', 'orderItemId', 'requestId', 'resolution', 'status'].sort());
    assert.equal(result.status, 'PENDING_INTEGRATION');
});
