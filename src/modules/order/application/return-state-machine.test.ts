import assert from 'node:assert/strict';
import test from 'node:test';
import { ReturnStateMachine, type ReturnState } from './return-state-machine';

const pod = { scope: 'POD' as const };

test('Buyer submits and eligible request enters the Printer queue', () => {
    assert.equal(ReturnStateMachine.canTransition('DRAFT', 'BUYER_SUBMIT', 'SUBMITTED', { ...pod, actor: 'BUYER' }), true);
    assert.equal(ReturnStateMachine.canTransition('SUBMITTED', 'ELIGIBILITY_PASSED', 'PENDING_PRINTER', { ...pod, actor: 'SYSTEM' }), true);
});

test('R99/admin-review eligibility routes submitted request to dispute review', () => {
    assert.equal(ReturnStateMachine.canTransition('SUBMITTED', 'ADMIN_REVIEW_REQUIRED', 'DISPUTED', { ...pod, actor: 'SYSTEM' }), true);
});

test('Printer approves/rejects ordinary requests but only proposes fault/classification changes', () => {
    assert.equal(ReturnStateMachine.canTransition('PENDING_PRINTER', 'PRINTER_APPROVE', 'APPROVED', { ...pod, actor: 'PRINTER' }), true);
    assert.equal(ReturnStateMachine.canTransition('PENDING_PRINTER', 'PRINTER_REJECT', 'REJECTED', { ...pod, actor: 'PRINTER' }), true);
    assert.equal(ReturnStateMachine.canTransition('PENDING_PRINTER', 'PRINTER_PROPOSE_FAULT_CHANGE', 'PRINTER_PROPOSED_FAULT_CHANGE', { ...pod, actor: 'PRINTER' }), true);
    assert.equal(ReturnStateMachine.canTransition('PRINTER_PROPOSED_FAULT_CHANGE', 'ADMIN_CONFIRM_FAULT_CHANGE', 'APPROVED', { ...pod, actor: 'ADMIN' }), true);
    assert.equal(ReturnStateMachine.canTransition('PENDING_PRINTER', 'PRINTER_SET_FAULT', 'APPROVED', { ...pod, actor: 'PRINTER' }), false);
    assert.equal(ReturnStateMachine.canTransition('DISPUTED', 'PRINTER_APPROVE', 'APPROVED', { ...pod, actor: 'PRINTER' }), false);
});

test('Printer-approved Refund waits for Admin confirmation before bridge execution', () => {
    assert.equal(ReturnStateMachine.canTransition('PENDING_PRINTER', 'PRINTER_APPROVE', 'AWAITING_ADMIN_REFUND', { ...pod, actor: 'PRINTER' }), true);
    assert.equal(ReturnStateMachine.canTransition('AWAITING_ADMIN_REFUND', 'ADMIN_CONFIRM_REFUND', 'CONVERTED_TO_REFUND', { ...pod, actor: 'ADMIN' }), true);
    assert.equal(ReturnStateMachine.canTransition('PENDING_PRINTER', 'PRINTER_APPROVE', 'CONVERTED_TO_REFUND', { ...pod, actor: 'PRINTER' }), false);
});

test('Refund requires an Admin confirmation after request approval', () => {
    assert.equal(ReturnStateMachine.canTransition('APPROVED', 'ADMIN_CONFIRM_REFUND', 'CONVERTED_TO_REFUND', { ...pod, actor: 'ADMIN' }), true);
    assert.equal(ReturnStateMachine.canTransition('WAITING_BUYER_CHOICE', 'BUYER_CHOOSE_REFUND', 'AWAITING_ADMIN_REFUND', { ...pod, actor: 'BUYER', now: new Date('2026-05-02T00:00:00Z'), deadline: new Date('2026-05-04T00:00:00Z') }), true);
    assert.equal(ReturnStateMachine.canTransition('AWAITING_ADMIN_REFUND', 'ADMIN_CONFIRM_REFUND', 'CONVERTED_TO_REFUND', { ...pod, actor: 'ADMIN' }), true);
    assert.equal(ReturnStateMachine.canTransition('WAITING_BUYER_CHOICE', 'BUYER_CHOOSE_REFUND', 'CONVERTED_TO_REFUND', { ...pod, actor: 'BUYER' }), false);
    assert.equal(ReturnStateMachine.canTransition('APPROVED', 'PRINTER_CONFIRM_REFUND', 'CONVERTED_TO_REFUND', { ...pod, actor: 'PRINTER' }), false);
});

test('Buyer may dispute a rejection and Admin resolves or rejects the dispute', () => {
    assert.equal(ReturnStateMachine.canTransition('REJECTED', 'BUYER_DISPUTE', 'DISPUTED', { ...pod, actor: 'BUYER', disputeCount: 0, now: new Date('2026-05-01T00:00:00Z'), deadline: new Date('2026-05-04T00:00:00Z') }), true);
    assert.equal(ReturnStateMachine.canTransition('DISPUTED', 'ADMIN_APPROVE', 'APPROVED', { ...pod, actor: 'ADMIN' }), true);
    assert.equal(ReturnStateMachine.canTransition('DISPUTED', 'ADMIN_REJECT', 'ADMIN_REJECTED', { ...pod, actor: 'ADMIN' }), true);
});

test('Buyer dispute is one-time and must remain within inclusive P04 deadline', () => {
    const deadline = new Date('2026-05-04T00:00:00Z');
    assert.equal(ReturnStateMachine.canTransition('REJECTED', 'BUYER_DISPUTE', 'DISPUTED', { ...pod, actor: 'BUYER', disputeCount: 1, now: deadline, deadline }), false);
    assert.equal(ReturnStateMachine.canTransition('REJECTED', 'BUYER_DISPUTE', 'DISPUTED', { ...pod, actor: 'BUYER', disputeCount: 0, now: deadline, deadline }), true);
    assert.equal(ReturnStateMachine.canTransition('REJECTED', 'BUYER_DISPUTE', 'DISPUTED', { ...pod, actor: 'BUYER', disputeCount: 0 }), false);
    assert.equal(ReturnStateMachine.canTransition('REJECTED', 'BUYER_DISPUTE', 'DISPUTED', { ...pod, actor: 'BUYER', disputeCount: 0, now: new Date(deadline.getTime() + 1), deadline }), false);
});

test('Buyer may cancel before a side effect and an overdue Printer request routes for review', () => {
    assert.equal(ReturnStateMachine.canTransition('PENDING_PRINTER', 'BUYER_CANCEL', 'CANCELLED', { ...pod, actor: 'BUYER', sideEffectStarted: false }), true);
    assert.equal(ReturnStateMachine.canTransition('PENDING_PRINTER', 'PRINTER_TIMEOUT', 'DISPUTED', { ...pod, actor: 'SYSTEM', now: new Date('2026-05-04T00:00:00Z'), deadline: new Date('2026-05-04T00:00:00Z') }), false);
    assert.equal(ReturnStateMachine.canTransition('PENDING_PRINTER', 'PRINTER_TIMEOUT', 'DISPUTED', { ...pod, actor: 'SYSTEM', now: new Date('2026-05-05T00:00:00Z'), deadline: new Date('2026-05-04T00:00:00Z') }), true);
    assert.equal(ReturnStateMachine.canTransition('PENDING_PRINTER', 'BUYER_CANCEL', 'CANCELLED', { ...pod, actor: 'BUYER', sideEffectStarted: true }), false);
});

test('out-of-stock choice may wait once and expires to review without auto-refund', () => {
    assert.equal(ReturnStateMachine.canTransition('APPROVED', 'STOCK_UNAVAILABLE', 'WAITING_BUYER_CHOICE', { ...pod, actor: 'SYSTEM' }), true);
    assert.equal(ReturnStateMachine.canTransition('WAITING_BUYER_CHOICE', 'BUYER_CHOOSE_WAIT', 'WAITING_STOCK', { ...pod, actor: 'BUYER', waitCount: 0, now: new Date('2026-05-02T00:00:00Z'), deadline: new Date('2026-05-04T00:00:00Z') }), true);
    assert.equal(ReturnStateMachine.canTransition('WAITING_BUYER_CHOICE', 'BUYER_CHOOSE_WAIT', 'WAITING_STOCK', { ...pod, actor: 'BUYER', waitCount: 1, now: new Date('2026-05-02T00:00:00Z'), deadline: new Date('2026-05-04T00:00:00Z') }), false);
    assert.equal(ReturnStateMachine.canTransition('WAITING_BUYER_CHOICE', 'BUYER_CHOOSE_REFUND', 'AWAITING_ADMIN_REFUND', { ...pod, actor: 'BUYER', now: new Date('2026-05-04T00:00:00Z'), deadline: new Date('2026-05-04T00:00:00Z') }), true);
    assert.equal(ReturnStateMachine.canTransition('WAITING_BUYER_CHOICE', 'BUYER_CHOOSE_WAIT', 'WAITING_STOCK', { ...pod, actor: 'BUYER', now: new Date('2026-05-04T00:00:00.001Z'), deadline: new Date('2026-05-04T00:00:00Z') }), false);
    assert.equal(ReturnStateMachine.canTransition('WAITING_BUYER_CHOICE', 'BUYER_CHOICE_EXPIRED', 'DISPUTED', { ...pod, actor: 'SYSTEM', now: new Date('2026-05-04T00:00:00Z'), deadline: new Date('2026-05-04T00:00:00Z') }), false);
    assert.equal(ReturnStateMachine.canTransition('WAITING_BUYER_CHOICE', 'BUYER_CHOICE_EXPIRED', 'DISPUTED', { ...pod, actor: 'SYSTEM', now: new Date('2026-05-04T00:00:00.001Z'), deadline: new Date('2026-05-04T00:00:00Z') }), true);
    assert.equal(ReturnStateMachine.canTransition('WAITING_STOCK', 'STOCK_WAIT_EXPIRED', 'DISPUTED', { ...pod, actor: 'SYSTEM', now: new Date('2026-05-15T00:00:00Z'), deadline: new Date('2026-05-15T00:00:00Z') }), false);
    assert.equal(ReturnStateMachine.canTransition('WAITING_STOCK', 'STOCK_WAIT_EXPIRED', 'DISPUTED', { ...pod, actor: 'SYSTEM', now: new Date('2026-05-15T00:00:00.001Z'), deadline: new Date('2026-05-15T00:00:00Z') }), true);
});

test('NORMAL and physical-return transitions are explicitly disabled by default flag', () => {
    const normal = ReturnStateMachine.canTransition('DRAFT', 'BUYER_SUBMIT', 'SUBMITTED', { scope: 'NORMAL', actor: 'BUYER' });
    const physical = ReturnStateMachine.canTransition('APPROVED', 'BUYER_RETURN_START', 'WAITING_RETURN', { scope: 'PHYSICAL_RETURN', actor: 'SYSTEM' });
    assert.deepEqual(normal, { allowed: false, reason: 'EXCHANGE_NORMAL_DISABLED' });
    assert.deepEqual(physical, { allowed: false, reason: 'EXCHANGE_NORMAL_DISABLED' });
});

test('Replacement Created and Completed have no incoming transitions in Lot 1', () => {
    const states: ReturnState[] = ['DRAFT', 'SUBMITTED', 'PENDING_PRINTER', 'APPROVED', 'REJECTED', 'DISPUTED', 'ADMIN_REJECTED', 'WAITING_BUYER_CHOICE', 'WAITING_STOCK', 'CONVERTED_TO_REFUND', 'EXPIRED', 'CANCELLED'];
    for (const state of states) {
        assert.equal(ReturnStateMachine.canTransition(state, 'REPLACEMENT_CREATE', 'REPLACEMENT_CREATED', { ...pod, actor: 'SYSTEM' }), false);
        assert.equal(ReturnStateMachine.canTransition(state, 'REPLACEMENT_COMPLETED', 'COMPLETED', { ...pod, actor: 'SYSTEM' }), false);
    }
    assert.equal(ReturnStateMachine.canTransition('COMPLETED', 'BUYER_CANCEL', 'CANCELLED', { ...pod, actor: 'BUYER' }), false);
});

test('every declared NORMAL transition is blocked by the default feature flag', () => {
    const cases = [
        ['DRAFT', 'BUYER_SUBMIT', 'SUBMITTED', 'BUYER'],
        ['APPROVED', 'BUYER_RETURN_START', 'WAITING_RETURN', 'SYSTEM'],
        ['WAITING_RETURN', 'PRINTER_RETURN_RECEIVED', 'RETURN_RECEIVED', 'PRINTER'],
        ['WAITING_RETURN', 'PRINTER_RETURN_FAILED', 'RETURN_FAILED', 'PRINTER'],
        ['WAITING_RETURN', 'RETURN_WINDOW_EXPIRED', 'EXPIRED', 'SYSTEM'],
        ['RETURN_RECEIVED', 'REPLACEMENT_CREATE', 'REPLACEMENT_CREATED', 'SYSTEM'],
        ['RETURN_RECEIVED', 'EXCHANGE_TO_REFUND', 'CONVERTED_TO_REFUND', 'SYSTEM'],
        ['RETURN_FAILED', 'BUYER_DISPUTE', 'DISPUTED', 'BUYER'],
    ] as const;
    for (const [from, action, to, actor] of cases) {
        assert.deepEqual(ReturnStateMachine.canTransition(from, action, to, { scope: 'NORMAL', actor }), { allowed: false, reason: 'EXCHANGE_NORMAL_DISABLED' });
    }
});

test('cannot take a transition when actor, scope, or state/action tuple is invalid', () => {
    assert.equal(ReturnStateMachine.canTransition('PENDING_PRINTER', 'PRINTER_APPROVE', 'APPROVED', { ...pod, actor: 'SELLER' }), false);
    assert.equal(ReturnStateMachine.canTransition('PENDING_PRINTER', 'BUYER_DISPUTE', 'DISPUTED', { ...pod, actor: 'BUYER' }), false);
    assert.equal(ReturnStateMachine.canTransition('EXPIRED', 'ADMIN_APPROVE', 'APPROVED', { ...pod, actor: 'ADMIN' }), false);
});
