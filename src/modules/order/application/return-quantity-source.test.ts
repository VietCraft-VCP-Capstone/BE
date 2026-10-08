import assert from 'node:assert/strict';
import test from 'node:test';
import { ReturnRequestV3 } from '../infrastructure/models/return-request-v3.model';
import { RefundRequest } from '../infrastructure/models/refund-request.model';
import { getOrderItemReturnQuantityUsage, getReturnQuantityUsage } from './return-quantity-source';

// Evaluate the generated aggregate against fixtures without opening a Mongo connection.
function value(expression: any, row: any): any {
    if (typeof expression === 'string' && expression.startsWith('$')) return row[expression.slice(1)];
    if (Array.isArray(expression)) return expression.map(item => value(item, row));
    if (expression == null || typeof expression !== 'object') return expression;
    const [operator, operand] = Object.entries(expression)[0] as [string, any];
    const args = value(operand, row);
    if (operator === '$cond') return args[0] ? args[1] : args[2];
    if (operator === '$eq') return args[0] === args[1];
    if (operator === '$in') return args[1].includes(args[0]);
    if (operator === '$ifNull') return args[0] ?? args[1];
    if (operator === '$and') return args.every(Boolean);
    if (operator === '$or') return args.some(Boolean);
    throw new Error(`Unsupported test operator ${operator}`);
}

test('quantity usage sums units and consumes terminal refunds/replacements without double counting converted refunds', async () => {
    const original = ReturnRequestV3.aggregate;
    const requests = [
        { order_id: 'o1', order_item_id: 'i1', status: 'COMPLETED', final_resolution: 'REFUND', quantity: 2 },
        { order_id: 'o1', order_item_id: 'i1', status: 'COMPLETED', final_resolution: 'EXCHANGE', quantity: 1 },
        { order_id: 'o1', order_item_id: 'i1', status: 'REPLACEMENT_CREATED', final_resolution: 'EXCHANGE', quantity: 3 },
        { order_id: 'o1', order_item_id: 'i1', status: 'CONVERTED_TO_REFUND', final_resolution: 'REFUND', quantity: 4 },
        { order_id: 'o1', order_item_id: 'i1', status: 'PENDING_PRINTER', quantity: 2 },
        { order_id: 'o1', order_item_id: 'i1', status: 'ADMIN_REJECTED', quantity: 20 },
        { order_id: 'other-order', order_item_id: 'i1', status: 'COMPLETED', final_resolution: 'REFUND', quantity: 100 },
    ];
    (ReturnRequestV3 as any).aggregate = async (pipeline: any[]) => {
        assert.deepEqual(pipeline[0].$match, { order_id: 'o1', order_item_id: 'i1' });
        const matched = requests.filter(row => row.order_id === 'o1' && row.order_item_id === 'i1');
        const result: any = {};
        for (const [key, expression] of Object.entries(pipeline[1].$group)) {
            if (key !== '_id') result[key] = matched.reduce((total, row) => total + value((expression as any).$sum, row), 0);
        }
        return [result];
    };
    try { assert.deepEqual(await getReturnQuantityUsage('o1', 'i1'), { refundedQuantity: 2, replacedQuantity: 4, activeReservedQuantity: 6 }); }
    finally { ReturnRequestV3.aggregate = original; }
});

test('legacy pending/refunded order requests block V3 quantities, while a V3-only refund leaves sibling items available', async () => {
    const originalAggregate = ReturnRequestV3.aggregate;
    const originalFind = RefundRequest.findOne;
    let legacy: any = null;
    (ReturnRequestV3 as any).aggregate = async () => [];
    (RefundRequest as any).findOne = () => ({ select: () => ({ lean: async () => legacy }) });
    try {
        const order = { _id: 'o1', refund_status: 'REFUNDED' };
        assert.deepEqual(await getOrderItemReturnQuantityUsage(order, 'untouched-item', 3), { replacedQuantity: 0, refundedQuantity: 0, activeReservedQuantity: 0 });
        legacy = { status: 'PENDING_PRINTER' };
        assert.equal((await getOrderItemReturnQuantityUsage({ ...order, refund_status: 'UNDER_REVIEW' }, 'untouched-item', 3)).activeReservedQuantity, 3);
        legacy = { status: 'REFUNDED', execution_status: 'SUCCEEDED' };
        assert.equal((await getOrderItemReturnQuantityUsage(order, 'untouched-item', 3)).refundedQuantity, 3);
    } finally { ReturnRequestV3.aggregate = originalAggregate; RefundRequest.findOne = originalFind; }
});
