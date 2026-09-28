import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { RefundStateMachine } from './refund-state-machine';

test('seller triages POD to itself or to Printer', () => {
    assert.equal(RefundStateMachine.canTransition('PENDING_SELLER', 'seller-triage', 'PENDING_SELLER'), true);
    assert.equal(RefundStateMachine.canTransition('PENDING_SELLER', 'seller-triage', 'PENDING_PRINTER'), true);
});

test('seller cannot decide after request is disputed', () => {
    assert.equal(RefundStateMachine.canTransition('DISPUTED', 'seller-decision', 'SELLER_APPROVED'), false);
});

test('buyer can dispute seller or Printer rejection and timeout', () => {
    for (const status of ['SELLER_REJECTED', 'PRINTER_REJECTED', 'TIMEOUT_ESCALATED'] as const) {
        assert.equal(RefundStateMachine.canTransition(status, 'buyer-dispute', 'DISPUTED'), true);
    }
});

test('buyer or seller can dispute Printer decision before the final Admin ruling', () => {
    assert.equal(RefundStateMachine.canTransition('PRINTER_APPROVED', 'buyer-dispute', 'DISPUTED'), true);
    assert.equal(RefundStateMachine.canTransition('PRINTER_REJECTED', 'seller-dispute', 'DISPUTED'), true);
});

test('Printer SLA timeout escalates straight to Admin dispute', () => {
    assert.equal(RefundStateMachine.canTransition('PENDING_PRINTER', 'timeout', 'DISPUTED'), true);
});

test('Admin decision is terminal, with no appeal transition', () => {
    assert.equal(RefundStateMachine.canTransition('ADMIN_APPROVED', 'buyer-dispute', 'DISPUTED'), false);
    assert.equal(RefundStateMachine.canTransition('ADMIN_REJECTED', 'buyer-dispute', 'DISPUTED'), false);
});
