import assert from 'node:assert/strict';
import test from 'node:test';
import { canReturnActorPerform, type ReturnActorAction, type ReturnActorContext } from './return-actor-policy';

const base = (overrides: Partial<ReturnActorContext> = {}): ReturnActorContext => ({
    actor: 'BUYER', userId: 'buyer-1', orderOwnedByBuyer: true, sellerOwnsRequest: false,
    assignedPrinter: false, faultSellerId: null, appealUsed: false, correctionCount: 0,
    sideEffectStarted: false, scope: 'POD', ...overrides,
});

const check = (action: ReturnActorAction, context: Partial<ReturnActorContext> = {}) => canReturnActorPerform(action, base(context));

test('Buyer actions require ownership of the order', () => {
    assert.equal(check('BUYER_SUBMIT').allowed, true);
    assert.equal(check('BUYER_VIEW', { orderOwnedByBuyer: false }).allowed, false);
    assert.equal(check('BUYER_DISPUTE', { orderOwnedByBuyer: false }).allowed, false);
});

test('Seller can only view and supplement evidence for its own request', () => {
    assert.equal(check('SELLER_VIEW', { actor: 'SELLER', sellerOwnsRequest: true }).allowed, true);
    assert.equal(check('SELLER_ADD_EVIDENCE', { actor: 'SELLER', sellerOwnsRequest: true }).allowed, true);
    assert.equal(check('SELLER_VIEW', { actor: 'SELLER', sellerOwnsRequest: false }).allowed, false);
});

test('only the assigned-fault Seller can appeal, at most once', () => {
    const context = { actor: 'SELLER' as const, userId: 'seller-1', sellerOwnsRequest: true, faultSellerId: 'seller-1' };
    assert.equal(check('SELLER_APPEAL', context).allowed, true);
    assert.equal(check('SELLER_APPEAL', { ...context, faultSellerId: 'seller-2' }).allowed, false);
    assert.equal(check('SELLER_APPEAL', { ...context, appealUsed: true }).allowed, false);
});

test('Seller cannot approve/reject or assign fault', () => {
    for (const action of ['SELLER_APPROVE', 'SELLER_REJECT', 'SELLER_ASSIGN_FAULT'] as const) {
        assert.equal(check(action, { actor: 'SELLER', sellerOwnsRequest: true }).allowed, false);
    }
});

test('assigned Printer may view, supplement evidence, approve/reject ordinary requests and propose fault changes', () => {
    for (const action of ['PRINTER_VIEW', 'PRINTER_ADD_EVIDENCE', 'PRINTER_APPROVE', 'PRINTER_REJECT', 'PRINTER_REQUEST_EVIDENCE', 'PRINTER_PROPOSE_FAULT_CHANGE'] as const) {
        assert.equal(check(action, { actor: 'PRINTER', assignedPrinter: true }).allowed, true);
        assert.equal(check(action, { actor: 'PRINTER', assignedPrinter: false }).allowed, false);
    }
});

test('Printer cannot finalize classification or assign fault', () => {
    for (const action of ['PRINTER_ASSIGN_FAULT', 'PRINTER_CONFIRM_FAULT_CHANGE'] as const) {
        assert.equal(check(action, { actor: 'PRINTER', assignedPrinter: true }).allowed, false);
    }
});



test('Printer cannot assign fault or perform Admin decision/correction', () => {
    assert.equal(check('PRINTER_ASSIGN_FAULT', { actor: 'PRINTER', assignedPrinter: true }).allowed, false);
    assert.equal(check('ADMIN_FINALIZE', { actor: 'PRINTER', assignedPrinter: true }).allowed, false);
    assert.equal(check('ADMIN_CORRECT', { actor: 'PRINTER', assignedPrinter: true }).allowed, false);
});

test('Admin may finalize decision and correct it only once before side effect', () => {
    assert.equal(check('ADMIN_FINALIZE', { actor: 'ADMIN' }).allowed, true);
    assert.equal(check('ADMIN_CORRECT', { actor: 'ADMIN', correctionCount: 0, sideEffectStarted: false }).allowed, true);
    assert.equal(check('ADMIN_CORRECT', { actor: 'ADMIN', correctionCount: 1, sideEffectStarted: false }).allowed, false);
    assert.equal(check('ADMIN_CORRECT', { actor: 'ADMIN', correctionCount: 0, sideEffectStarted: true }).allowed, false);
});

test('unsupported or non-POD actor actions fail closed', () => {
    const context = base({ scope: 'NORMAL' });
    assert.equal(canReturnActorPerform('BUYER_SUBMIT', { actor: 'BUYER', orderOwnedByBuyer: true }).allowed, false);
    assert.equal(canReturnActorPerform('BUYER_SUBMIT', context).allowed, false);
    assert.equal(check('ADMIN_FINALIZE', { actor: 'ADMIN', isPOD: false }).allowed, false);
});
