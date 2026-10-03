import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buyerCanDispute, initialRefundStatus, sellerCanActOnRefund } from './refund-actor-policy';

test('POD refund starts with Printer while normal refund starts with seller', () => {
    assert.equal(initialRefundStatus('POD'), 'PENDING_PRINTER');
    assert.equal(initialRefundStatus('NORMAL'), 'PENDING_SELLER');
});

test('Seller may act only on normal product refunds', () => {
    assert.equal(sellerCanActOnRefund('POD'), false);
    assert.equal(sellerCanActOnRefund('NORMAL'), true);
});

test('Buyer may dispute POD only after Printer rejection', () => {
    assert.equal(buyerCanDispute('POD', 'PENDING_PRINTER'), false);
    assert.equal(buyerCanDispute('POD', 'PRINTER_APPROVED'), false);
    assert.equal(buyerCanDispute('POD', 'PRINTER_REJECTED'), true);
});

test('Normal-product Buyer dispute remains available after Seller rejection', () => {
    assert.equal(buyerCanDispute('NORMAL', 'SELLER_REJECTED'), true);
    assert.equal(buyerCanDispute('NORMAL', 'PRINTER_APPROVED'), true);
    assert.equal(buyerCanDispute('NORMAL', 'PRINTER_REJECTED'), true);
    assert.equal(buyerCanDispute('NORMAL', 'PENDING_PRINTER'), false);
});

test('Buyer may dispute after SLA timeout', () => {
    assert.equal(buyerCanDispute('POD', 'TIMEOUT_ESCALATED'), true);
    assert.equal(buyerCanDispute('NORMAL', 'TIMEOUT_ESCALATED'), true);
});
