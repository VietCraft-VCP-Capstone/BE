import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { RefundStateMachine } from './refund-state-machine';
import { initialRefundStatus, sellerCanActOnRefund } from './refund-actor-policy';

test('POD refund starts with Printer and normal refund starts with seller', () => {
    assert.equal(initialRefundStatus('POD'), 'PENDING_PRINTER');
    assert.equal(initialRefundStatus('NORMAL'), 'PENDING_SELLER');
});

test('Seller may view POD refunds but cannot act on them', () => {
    assert.equal(sellerCanActOnRefund('POD'), false);
    assert.equal(sellerCanActOnRefund('NORMAL'), true);
});

test('Seller decision transitions stay available for normal products', () => {
    assert.equal(RefundStateMachine.canTransition('PENDING_SELLER', 'seller-decision', 'SELLER_APPROVED'), true);
    assert.equal(RefundStateMachine.canTransition('PENDING_SELLER', 'seller-decision', 'SELLER_REJECTED'), true);
});

test('Seller triage transitions are disabled', () => {
    assert.equal(RefundStateMachine.canTransition('PENDING_SELLER', 'seller-triage', 'PENDING_SELLER'), false);
    assert.equal(RefundStateMachine.canTransition('PENDING_SELLER', 'seller-triage', 'PENDING_PRINTER'), false);
});

test('Seller cannot decide after request is disputed', () => {
    assert.equal(RefundStateMachine.canTransition('DISPUTED', 'seller-decision', 'SELLER_APPROVED'), false);
});

test('Buyer can dispute rejection, Printer decision, and timeout', () => {
    for (const status of ['SELLER_REJECTED', 'PRINTER_APPROVED', 'PRINTER_REJECTED', 'TIMEOUT_ESCALATED'] as const) {
        assert.equal(RefundStateMachine.canTransition(status, 'buyer-dispute', 'DISPUTED'), true);
    }
});

test('Seller cannot dispute a Printer decision because Seller is view-only for POD', () => {
    assert.equal(RefundStateMachine.canTransition('PRINTER_APPROVED', 'seller-dispute', 'DISPUTED'), false);
    assert.equal(RefundStateMachine.canTransition('PRINTER_REJECTED', 'seller-dispute', 'DISPUTED'), false);
});

test('Printer SLA timeout escalates straight to Admin dispute', () => {
    assert.equal(RefundStateMachine.canTransition('PENDING_PRINTER', 'timeout', 'DISPUTED'), true);
});

test('Admin decision is terminal, with no appeal transition', () => {
    assert.equal(RefundStateMachine.canTransition('ADMIN_APPROVED', 'buyer-dispute', 'DISPUTED'), false);
    assert.equal(RefundStateMachine.canTransition('ADMIN_REJECTED', 'buyer-dispute', 'DISPUTED'), false);
});
