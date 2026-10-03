import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import test from 'node:test';
import { Order } from '../infrastructure/models/order.model';
import {
    buildOrderStatusSimulationUpdate,
    isOrderStatusSimulationEnabled,
    readOrderStatusSimulationGate,
    MongoOrderStatusSimulatorRepository,
    OrderStatusSimulationError,
    OrderStatusSimulationService,
    type OrderStatusSimulatorRepository,
    type SimulatableOrderStatus,
    type SimulatedOrderStatusResult,
} from './order-status-simulator.service';

class FakeRepository implements OrderStatusSimulatorRepository {
    calls: unknown[][] = [];
    result: SimulatedOrderStatusResult | null = { orderId: 'db-id', orderCode: 'TEST-STATUS-1', orderStatus: 'SHIPPING', paymentStatus: 'PENDING' };
    async createOwnedTestOrderCopy(orderId: string, buyerId: string) { this.calls.push(['copy', orderId, buyerId]); return this.result?.orderCode ?? null; }
    async updateOwnedTestOrder(...args: [string, string, SimulatableOrderStatus, Date]) { this.calls.push(['update', ...args]); return this.result; }
}

test('simulation update changes order status only and adds status history', () => {
    const at = new Date('2026-10-03T00:00:00Z');
    assert.deepEqual(buildOrderStatusSimulationUpdate('SHIPPING', at), { $set: { order_status: 'SHIPPING' }, $push: { status_history: { status: 'SHIPPING', changed_at: at, note: 'Mô phỏng trạng thái trong môi trường development; không thay đổi thanh toán.' } } });
});
test('development simulation updates a buyer-owned isolated copy with payment pending', async () => {
    const repository = new FakeRepository();
    const service = new OrderStatusSimulationService(repository, 'development', { now: () => new Date('2026-10-03T00:00:00Z') }, 'true');
    const result = await service.simulate({ orderId: 'VC-100', buyerId: 'buyer-1', target: 'SHIPPING' });
    assert.equal(result.paymentStatus, 'PENDING');
    assert.deepEqual(repository.calls.map(call => call[0]), ['copy', 'update']);
});
test('feature gate requires development and exact opt-in', () => {
    assert.equal(isOrderStatusSimulationEnabled('development', 'true'), true);
    assert.equal(isOrderStatusSimulationEnabled('development', 'false'), false);
    assert.equal(isOrderStatusSimulationEnabled('production', 'true'), false);
    assert.equal(isOrderStatusSimulationEnabled('development', undefined), false);
});
test('copy limit defaults safely and clamps maximum', () => {
    assert.deepEqual(readOrderStatusSimulationGate({ NODE_ENV: 'development' } as NodeJS.ProcessEnv), { enabled: false, maxCopiesPerBuyer: 3 });
    assert.deepEqual(readOrderStatusSimulationGate({ NODE_ENV: 'development', ENABLE_DEV_ORDER_SIMULATION: 'true', DEV_ORDER_SIMULATION_MAX_COPIES_PER_BUYER: '100' } as NodeJS.ProcessEnv), { enabled: true, maxCopiesPerBuyer: 20 });
});
test('simulation is disabled outside development without repository effects', async () => {
    const repository = new FakeRepository();
    await assert.rejects(new OrderStatusSimulationService(repository, 'production').simulate({ orderId: 'VC-1', buyerId: 'b1', target: 'DELIVERED' }), OrderStatusSimulationError);
    assert.equal(repository.calls.length, 0);
});
test('simulation rejects payment/cancellation targets', async () => {
    const repository = new FakeRepository();
    const service = new OrderStatusSimulationService(repository, 'development', undefined, 'true');
    for (const target of ['CANCELLED', 'REFUNDED'] as unknown as SimulatableOrderStatus[]) await assert.rejects(service.simulate({ orderId: 'VC-1', buyerId: 'b1', target }), OrderStatusSimulationError);
    assert.equal(repository.calls.length, 0);
});
test('copy is marked, detached from seller and contains no payment references', async () => {
    const originalFindOne = Order.findOne, originalCreate = Order.create, originalCount = Order.countDocuments;
    const buyerId = new mongoose.Types.ObjectId(), sourceId = new mongoose.Types.ObjectId(), sourceShop = new mongoose.Types.ObjectId();
    let lookup = 0, created: any;
    (Order as any).findOne = () => ({ lean: async () => ++lookup === 1 ? { _id: sourceId, buyer_id: buyerId, shop_id: sourceShop, payment_method: 'COD', items: [{}], financial_breakdown: {}, shipping_address: {}, shipping_details: {} } : null });
    (Order as any).countDocuments = async () => 0;
    (Order as any).create = async (copy: any) => { created = copy; return { order_code: copy.order_code }; };
    try {
        await new MongoOrderStatusSimulatorRepository(3).createOwnedTestOrderCopy('VC-1', buyerId.toString(), new Date());
        assert.equal(created.is_simulated, true); assert.notEqual(created.shop_id.toString(), sourceShop.toString());
        assert.match(created.items[0].order_item_id, /^[0-9a-f-]{36}$/i); assert.ok(created.items[0].item_snapshot);
        assert.equal(created.payment_status, 'PENDING'); assert.equal(created.transaction_id, undefined); assert.equal(created.payment_reference, undefined); assert.equal(created.vnpay_transaction_no, undefined);
    } finally { (Order as any).findOne = originalFindOne; (Order as any).create = originalCreate; (Order as any).countDocuments = originalCount; }
});
test('copy limit rejects additional copies', async () => {
    const originalFindOne = Order.findOne, originalCreate = Order.create, originalCount = Order.countDocuments;
    const buyerId = new mongoose.Types.ObjectId(), sourceId = new mongoose.Types.ObjectId(); let lookup = 0, creates = 0;
    (Order as any).findOne = () => ({ lean: async () => ++lookup === 1 ? { _id: sourceId, buyer_id: buyerId, shop_id: new mongoose.Types.ObjectId(), payment_method: 'COD', items: [{}], financial_breakdown: {}, shipping_address: {}, shipping_details: {} } : null });
    (Order as any).countDocuments = async () => 1;
    (Order as any).create = async () => { creates += 1; return {}; };
    try { await assert.rejects(new MongoOrderStatusSimulatorRepository(1).createOwnedTestOrderCopy('VC-1', buyerId.toString(), new Date()), (error: unknown) => error instanceof OrderStatusSimulationError && error.statusCode === 429); assert.equal(creates, 0); }
    finally { (Order as any).findOne = originalFindOne; (Order as any).create = originalCreate; (Order as any).countDocuments = originalCount; }
});
test('status update requires owner and simulation marker and leaves payment unchanged', async () => {
    const original = Order.findOneAndUpdate;
    const buyerId = new mongoose.Types.ObjectId();
    let filter: any;
    let update: any;
    (Order as any).findOneAndUpdate = (query: any, changes: any) => {
        filter = query;
        update = changes;
        return {
            select: () => ({
                lean: async () => ({
                    _id: new mongoose.Types.ObjectId(),
                    order_code: 'TEST-1',
                    order_status: 'DELIVERED',
                    payment_status: 'PENDING',
                }),
            }),
        };
    };
    try {
        const result = await new MongoOrderStatusSimulatorRepository().updateOwnedTestOrder('TEST-1', buyerId.toString(), 'DELIVERED', new Date());
        assert.equal(filter.buyer_id.toString(), buyerId.toString());
        assert.equal(filter.is_simulated, true);
        assert.deepEqual(update.$set, { order_status: 'DELIVERED' });
        assert.equal(result?.paymentStatus, 'PENDING');
    } finally {
        (Order as any).findOneAndUpdate = original;
    }
});
