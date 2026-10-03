import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createActiveReturnRequest,
    markReplacementCreated,
    validateRequestedQuantity,
    type ActiveRequestRepository,
    type ExchangeQuotaRepository,
} from './return-quantity-policy';

class MemoryActiveRequestRepository implements ActiveRequestRepository {
    readonly active = new Map<string, string>();
    async createIfAbsent(orderItemId: string, requestId: string): Promise<boolean> {
        if (this.active.has(orderItemId)) return false;
        this.active.set(orderItemId, requestId);
        return true;
    }
}

class MemoryQuotaRepository implements ExchangeQuotaRepository {
    readonly consumed = new Map<string, string>();
    async consumeOnce(orderItemId: string, requestId: string): Promise<'CONSUMED' | 'SAME_REQUEST' | 'CONFLICT'> {
        const existing = this.consumed.get(orderItemId);
        if (existing === requestId) return 'SAME_REQUEST';
        if (existing) return 'CONFLICT';
        this.consumed.set(orderItemId, requestId);
        return 'CONSUMED';
    }
}

test('one active request per item returns 409 for conflict while another item is independent', async () => {
    const repository = new MemoryActiveRequestRepository();
    assert.deepEqual(await createActiveReturnRequest(repository, 'item-1', 'request-1'), { kind: 'CREATED' });
    assert.deepEqual(await createActiveReturnRequest(repository, 'item-1', 'request-2'), { kind: 'CONFLICT', statusCode: 409 });
    assert.deepEqual(await createActiveReturnRequest(repository, 'item-2', 'request-3'), { kind: 'CREATED' });
});

test('concurrent create attempts rely on atomic repository uniqueness and only one wins', async () => {
    const repository = new MemoryActiveRequestRepository();
    const results = await Promise.all([
        createActiveReturnRequest(repository, 'item-1', 'request-a'),
        createActiveReturnRequest(repository, 'item-1', 'request-b'),
    ]);
    assert.equal(results.filter(result => result.kind === 'CREATED').length, 1);
    assert.equal(results.filter(result => result.kind === 'CONFLICT').length, 1);
});

test('requested quantity must be a positive integer within remaining item quantity', () => {
    assert.deepEqual(validateRequestedQuantity({ requested: 2, ordered: 5, alreadyReplaced: 1, alreadyRefunded: 1, activeReserved: 1 }), { kind: 'VALID', remaining: 2 });
    assert.equal(validateRequestedQuantity({ requested: 0, ordered: 5 }).kind, 'INVALID');
    assert.equal(validateRequestedQuantity({ requested: 1.5, ordered: 5 }).kind, 'INVALID');
    assert.equal(validateRequestedQuantity({ requested: 3, ordered: 5, alreadyReplaced: 2, activeReserved: 1 }).kind, 'INVALID');
});

test('exchange quota is consumed only when replacement is created and only once per item', async () => {
    const repository = new MemoryQuotaRepository();
    assert.deepEqual(await markReplacementCreated(repository, 'item-1', 'request-1'), { kind: 'CONSUMED' });
    assert.deepEqual(await markReplacementCreated(repository, 'item-1', 'request-1'), { kind: 'CONSUMED' });
    assert.deepEqual(await markReplacementCreated(repository, 'item-1', 'request-2'), { kind: 'ALREADY_CONSUMED', statusCode: 409 });
    assert.deepEqual(await markReplacementCreated(repository, 'item-2', 'request-3'), { kind: 'CONSUMED' });
});
