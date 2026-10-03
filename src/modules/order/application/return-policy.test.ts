import assert from 'node:assert/strict';
import test from 'node:test';
import * as returnPolicyModule from './return-policy';
import {
    calculateActiveTimer,
    calculateFixedDeadline,
    calculateP09Deadline,
    calculateP03Timer,
    evaluateAnchoredWindow,
    evaluateP16EvidenceWindow,
    evaluatePodEligibility,
    evaluatePodEligibilityFromSource,
    isDeadlineExpired,
    type DeliveredEventSource,
    type VerifiedDeliveredEvent,
} from './return-policy';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const delivered: VerifiedDeliveredEvent = {
    eventId: 'evt-delivered-1',
    occurredAt: new Date('2026-05-01T10:00:00.000Z'),
    verified: true,
};

const eventSource = (event: VerifiedDeliveredEvent | null): DeliveredEventSource => ({
    async getVerifiedDeliveredEvent() { return event; },
});

test('POD defect reasons use the verified Delivered anchor and P01=72h', () => {
    const result = evaluatePodEligibility({ reasonCode: 'R02', now: new Date('2026-05-04T09:00:00Z'), deliveredEvent: delivered });
    assert.equal(result.kind, 'ELIGIBLE');
    if (result.kind === 'ELIGIBLE') {
        assert.equal(result.policyId, 'P01');
        assert.equal(result.deadline?.toISOString(), '2026-05-04T10:00:00.000Z');
        assert.deepEqual(result.allowedResolutions, ['EXCHANGE', 'REFUND']);
    }
});

test('deadline is inclusive and expires only when now is strictly later', () => {
    const deadline = new Date('2026-05-04T10:00:00.000Z');
    assert.equal(isDeadlineExpired(deadline, deadline), false);
    assert.equal(isDeadlineExpired(new Date(deadline.getTime() + 1), deadline), true);
});

test('R06 after Delivered uses its separate configurable 168h default, not P01/P02', () => {
    const result = evaluatePodEligibility({ reasonCode: 'R06', now: new Date('2026-05-08T09:00:00Z'), deliveredEvent: delivered });
    assert.equal(result.kind, 'ELIGIBLE');
    if (result.kind === 'ELIGIBLE') {
        assert.equal((result as any).policyId, 'R06_DELIVERED');
        assert.equal(result.deadline?.toISOString(), '2026-05-08T10:00:00.000Z');
    }
    const configured = evaluatePodEligibility({ reasonCode: 'R06', now: new Date('2026-05-06T09:00:00Z'), deliveredEvent: delivered, r06DeliveredWindowHours: 120 } as any);
    assert.equal(configured.kind, 'ELIGIBLE');
    if (configured.kind === 'ELIGIBLE') {
        assert.equal((configured as any).policyId, 'R06_DELIVERED');
        assert.equal(configured.deadline?.toISOString(), '2026-05-06T10:00:00.000Z');
    }
});

test('DPI warning alone never assigns fault; R06 needs an explicitly verified source', () => {
    const infer = (returnPolicyModule as any).inferDefaultFaultParty;
    assert.equal(typeof infer, 'function');
    if (typeof infer !== 'function') return;
    assert.equal(infer('R01', { dpiWarning: true }), 'PRINTER');
    assert.equal(infer('R02'), 'PRINTER');
    assert.equal(infer('R03'), 'PRINTER');
    assert.equal(infer('R04'), 'PRINTER');
    assert.equal(infer('R05'), 'CARRIER');
    assert.equal(infer('R08'), 'SELLER');
    assert.equal(infer('R09'), 'PLATFORM');
    assert.equal(infer('R13'), 'BUYER');
    assert.equal(infer('R01A', { dpiWarning: true }), null);
    assert.equal(infer('R07', { dpiWarning: true }), null);
    assert.equal(infer('R06'), null);
    assert.equal(infer('R06', { r06Source: 'CARRIER', sourceVerified: false }), null);
    assert.equal(infer('R06', { r06Source: 'CARRIER', sourceVerified: true }), 'CARRIER');
});

test('R06 delivered deadline helper defaults to 168 hours and accepts positive configuration', () => {
    const calculate = (returnPolicyModule as any).calculateR06DeliveredDeadline;
    assert.equal(typeof calculate, 'function');
    if (typeof calculate !== 'function') return;
    const anchor = new Date('2026-05-01T10:00:00Z');
    assert.equal(calculate(anchor)?.toISOString(), '2026-05-08T10:00:00.000Z');
    assert.equal(calculate(anchor, 120)?.toISOString(), '2026-05-06T10:00:00.000Z');
    assert.equal(calculate(anchor, 0), null);
});

test('R06 tracking eligibility starts at ETA+7d or immediately for lost/returned', () => {
    const eta = new Date('2026-05-01T10:00:00Z');
    const early = evaluatePodEligibility({ reasonCode: 'R06', now: new Date(eta.getTime() + 7 * DAY - 1), deliveredEvent: null, r06Tracking: { status: 'IN_TRANSIT', eventId: 'track-1', eventOccurredAt: eta, sourceAssigned: true, verified: true, latestEta: eta } });
    assert.equal(early.kind, 'NOT_YET_ELIGIBLE');
    const atBoundary = evaluatePodEligibility({ reasonCode: 'R06', now: new Date(eta.getTime() + 7 * DAY), deliveredEvent: null, r06Tracking: { status: 'IN_TRANSIT', eventId: 'track-1', eventOccurredAt: eta, sourceAssigned: true, verified: true, latestEta: eta } });
    assert.equal(atBoundary.kind, 'ELIGIBLE');
    if (atBoundary.kind === 'ELIGIBLE') assert.equal(atBoundary.policyId, 'P07');
    const lost = evaluatePodEligibility({ reasonCode: 'R06', now: eta, deliveredEvent: null, r06Tracking: { status: 'LOST', eventId: 'lost-1', eventOccurredAt: eta, sourceAssigned: true, verified: true } });
    assert.equal(evaluatePodEligibility({ reasonCode: 'R06', now: eta, deliveredEvent: null, r06Tracking: { status: 'LOST', eventId: 'lost-2', eventOccurredAt: eta, sourceAssigned: false, verified: true } }).kind, 'ADMIN_REVIEW');
    assert.equal(evaluatePodEligibility({ reasonCode: 'R06', now: eta, deliveredEvent: null, r06Tracking: { status: 'LOST', eventId: 'lost-3', eventOccurredAt: new Date(eta.getTime()+1), sourceAssigned: true, verified: true } }).kind, 'ADMIN_REVIEW');
    assert.equal(evaluatePodEligibility({ reasonCode: 'R06', now: new Date(eta.getTime() + 7 * DAY), deliveredEvent: null, r06Tracking: { status: 'IN_TRANSIT', eventId: 'future-eta', eventOccurredAt: eta, sourceAssigned: true, verified: true, latestEta: new Date(eta.getTime() + 24 * HOUR) } }).kind, 'NOT_YET_ELIGIBLE');
    assert.equal(evaluatePodEligibility({ reasonCode: 'R06', now: eta, deliveredEvent: null, r06Tracking: { status: 'LOST', eventId: 'lost-2', eventOccurredAt: eta, sourceAssigned: true, verified: false } }).kind, 'ADMIN_REVIEW');
    assert.equal(lost.kind, 'ELIGIBLE');
    if (lost.kind === 'ELIGIBLE') assert.equal(lost.deadline, null);
});

test('R99 and missing, invalid, or conflicting delivery evidence route to Admin review', () => {
    assert.equal(evaluatePodEligibility({ reasonCode: 'R99', now: delivered.occurredAt, deliveredEvent: delivered }).kind, 'ADMIN_REVIEW');
    assert.equal(evaluatePodEligibility({ reasonCode: null, now: delivered.occurredAt, deliveredEvent: delivered }).kind, 'ADMIN_REVIEW');
    assert.equal(evaluatePodEligibility({ reasonCode: 'R02', now: delivered.occurredAt, deliveredEvent: null }).kind, 'ADMIN_REVIEW');
    assert.equal(evaluatePodEligibility({ reasonCode: 'R02', now: delivered.occurredAt, deliveredEvent: { ...delivered, verified: false } }).kind, 'ADMIN_REVIEW');
    assert.equal(evaluatePodEligibility({ reasonCode: 'R02', now: delivered.occurredAt, deliveredEvent: { ...delivered, occurredAt: new Date('invalid') } }).kind, 'ADMIN_REVIEW');
    assert.equal(evaluatePodEligibility({ reasonCode: 'R02', now: delivered.occurredAt, deliveredEvent: { ...delivered, occurredAt: new Date(delivered.occurredAt.getTime() + 1) } }).kind, 'ADMIN_REVIEW');
    assert.equal(evaluatePodEligibility({ reasonCode: 'R06', now: delivered.occurredAt, deliveredEvent: null, r06Tracking: { status: 'UNKNOWN', eventId: 'unknown-1', eventOccurredAt: delivered.occurredAt, sourceAssigned: true, verified: true } }).kind, 'ADMIN_REVIEW');
});

test('NORMAL reasons are feature-disabled; disallowed POD reasons remain ineligible', () => {
    assert.equal(evaluatePodEligibility({ reasonCode: 'R10', now: delivered.occurredAt, deliveredEvent: delivered }).kind, 'FEATURE_DISABLED');
    assert.equal(evaluatePodEligibility({ reasonCode: 'R12', now: delivered.occurredAt, deliveredEvent: delivered }).kind, 'INELIGIBLE');
    assert.equal(evaluatePodEligibility({ reasonCode: 'R13', now: delivered.occurredAt, deliveredEvent: delivered }).kind, 'ELIGIBLE');
    assert.equal(evaluatePodEligibility({ reasonCode: 'R14', now: delivered.occurredAt, deliveredEvent: delivered }).kind, 'INELIGIBLE');
});

test('R01a is evidence-only for responsibility and permits Refund resolution only', () => {
    const result = evaluatePodEligibility({ reasonCode: 'R01a', now: new Date('2026-05-02T00:00:00Z'), deliveredEvent: delivered });
    assert.equal(result.kind, 'ELIGIBLE');
    if (result.kind === 'ELIGIBLE') assert.deepEqual(result.allowedResolutions, ['REFUND']);
});

test('DeliveredEventSource is injectable and a failed lookup fails closed to Admin review', async () => {
    const source = eventSource(delivered);
    const result = await evaluatePodEligibilityFromSource({ reasonCode: 'R03', now: new Date('2026-05-02T00:00:00Z'), orderId: 'o1', orderItemId: 'i1' }, source);
    assert.equal(result.kind, 'ELIGIBLE');
    const throwingSource: DeliveredEventSource = { async getVerifiedDeliveredEvent() { throw new Error('source unavailable'); } };
    assert.equal((await evaluatePodEligibilityFromSource({ reasonCode: 'R03', now: delivered.occurredAt, orderId: 'o1', orderItemId: 'i1' }, throwingSource)).kind, 'ADMIN_REVIEW');
});

test('fixed duration policies use exact elapsed hours/days', () => {
    const anchor = new Date('2026-01-01T00:00:00Z');
    const cases = [['P01', 72], ['P02', 168], ['P03', 48], ['P04', 72], ['P05', 72], ['P14', 72], ['P16', 24], ['P17', 14 * 24]] as const;
    for (const [policy, hours] of cases) assert.equal(calculateFixedDeadline(policy, anchor)?.getTime(), anchor.getTime() + hours * HOUR);
});

test('P09 adds three VN business days, skips weekends/holidays, and preserves local wall time', () => {
    const result = calculateP09Deadline(new Date('2026-04-30T03:15:20.000Z'), {
        version: 'vn-2026-v1',
        holidaysByYear: { '2026': ['2026-05-01'] },
    });
    assert.equal(result.kind, 'DEADLINE');
    if (result.kind === 'DEADLINE') assert.equal(result.deadline.toISOString(), '2026-05-06T03:15:20.000Z');
});

test('P09 missing calendar/version/coverage returns Admin review rather than guessing', () => {
    assert.equal(calculateP09Deadline(delivered.occurredAt, null).kind, 'ADMIN_REVIEW');
    assert.equal(calculateP09Deadline(delivered.occurredAt, { version: '', holidaysByYear: { '2026': [] } }).kind, 'ADMIN_REVIEW');
    const yearEnd = new Date('2026-12-31T03:00:00Z');
    assert.equal(calculateP09Deadline(yearEnd, { version: 'only-2026', holidaysByYear: { '2026': [] } }).kind, 'ADMIN_REVIEW');
});

test('P03 pause/resume extends the deadline by completed pause time', () => {
    const result = calculateActiveTimer(new Date('2026-05-01T00:00:00Z'), 48 * HOUR, [
        { reason: 'P16', startedAt: new Date('2026-05-02T00:00:00Z'), endedAt: new Date('2026-05-03T00:00:00Z') },
    ], new Date('2026-05-03T00:00:00Z'));
    assert.equal(result.kind, 'RUNNING');
    if (result.kind === 'RUNNING') assert.equal(result.deadline.toISOString(), '2026-05-04T00:00:00.000Z');
});

test('P03 has no deadline while paused and reports remaining active duration', () => {
    const result = calculateActiveTimer(new Date('2026-05-01T00:00:00Z'), 48 * HOUR, [
        { reason: 'STOCK_WAIT', startedAt: new Date('2026-05-02T00:00:00Z'), endedAt: null },
    ], new Date('2026-05-02T12:00:00Z'));
    assert.equal(result.kind, 'PAUSED');
    if (result.kind === 'PAUSED') {
        assert.equal(result.deadline, null);
        assert.equal(result.remainingMs, 24 * HOUR);
    }
});

test('P03 pauses are limited to one P16 and one stock wait, with P16/P17 caps', () => {
    const anchor = new Date('2026-05-01T00:00:00Z');
    const now = new Date('2026-05-20T00:00:00Z');
    const duplicate = calculateActiveTimer(anchor, 48 * HOUR, [
        { reason: 'P16', startedAt: new Date('2026-05-01T01:00:00Z'), endedAt: new Date('2026-05-01T02:00:00Z') },
        { reason: 'P16', startedAt: new Date('2026-05-01T03:00:00Z'), endedAt: new Date('2026-05-01T04:00:00Z') },
    ], now);
    assert.equal(duplicate.kind, 'ADMIN_REVIEW');
    const p16Overrun = calculateActiveTimer(anchor, 48 * HOUR, [
        { reason: 'P16', startedAt: new Date('2026-05-01T01:00:00Z'), endedAt: new Date('2026-05-02T01:00:00.001Z') },
    ], now);
    assert.equal(p16Overrun.kind, 'ADMIN_REVIEW');
    const stockOverrun = calculateActiveTimer(anchor, 48 * HOUR, [
        { reason: 'STOCK_WAIT', startedAt: new Date('2026-05-01T01:00:00Z'), endedAt: new Date('2026-05-15T01:00:00.001Z') },
    ], now);
    assert.equal(stockOverrun.kind, 'ADMIN_REVIEW');
});

test('P03 cannot pause after its active deadline already elapsed', () => {
    const anchor = new Date('2026-05-01T00:00:00Z');
    const result = calculateP03Timer(anchor, [{ reason: 'P16', startedAt: new Date('2026-05-04T00:00:00Z'), endedAt: new Date('2026-05-04T01:00:00Z') }], new Date('2026-05-04T01:00:00Z'));
    assert.equal(result.kind, 'ADMIN_REVIEW');
});

test('P03 invalid/overlapping pause records route to Admin review', () => {
    const result = calculateActiveTimer(new Date('2026-05-01T00:00:00Z'), 48 * HOUR, [
        { reason: 'P16', startedAt: new Date('2026-05-02T00:00:00Z'), endedAt: new Date('2026-05-03T00:00:00Z') },
        { reason: 'STOCK_WAIT', startedAt: new Date('2026-05-02T12:00:00Z'), endedAt: new Date('2026-05-03T12:00:00Z') },
    ], new Date('2026-05-04T00:00:00Z'));
    assert.equal(result.kind, 'ADMIN_REVIEW');
});

test('P04 dispute and P05 Seller appeal windows use 72h from decision/fault notification', () => {
    const decisionNotifiedAt = new Date('2026-05-01T10:00:00Z');
    const p04 = evaluateAnchoredWindow('P04', decisionNotifiedAt, new Date('2026-05-04T10:00:00Z'));
    assert.equal(p04.kind, 'OPEN');
    if (p04.kind === 'OPEN') assert.equal(p04.deadline.toISOString(), '2026-05-04T10:00:00.000Z');
    const faultNotifiedAt = new Date('2026-05-01T10:00:00Z');
    const p05 = evaluateAnchoredWindow('P05', faultNotifiedAt, new Date('2026-05-04T10:00:00Z'));
    assert.equal(p05.kind, 'OPEN');
    if (p05.kind === 'OPEN') assert.equal(p05.deadline.toISOString(), '2026-05-04T10:00:00.000Z');
    assert.equal(evaluateAnchoredWindow('P05', faultNotifiedAt, new Date('2026-05-04T10:00:00.001Z')).kind, 'EXPIRED');
});

test('P14/P17 windows are anchored to notice/wait events and inclusive', () => {
    const notifiedAt = new Date('2026-05-01T10:00:00Z');
    const p14 = evaluateAnchoredWindow('P14', notifiedAt, new Date('2026-05-04T10:00:00Z'));
    assert.equal(p14.kind, 'OPEN');
    if (p14.kind === 'OPEN') assert.equal(p14.deadline.toISOString(), '2026-05-04T10:00:00.000Z');
    assert.equal(evaluateAnchoredWindow('P14', notifiedAt, new Date('2026-05-04T10:00:00.001Z')).kind, 'EXPIRED');

    const waitStartedAt = new Date('2026-05-01T10:00:00Z');
    const p17 = evaluateAnchoredWindow('P17', waitStartedAt, new Date('2026-05-15T10:00:00Z'));
    assert.equal(p17.kind, 'OPEN');
    if (p17.kind === 'OPEN') assert.equal(p17.deadline.toISOString(), '2026-05-15T10:00:00.000Z');
    assert.equal(evaluateAnchoredWindow('P17', waitStartedAt, new Date('2026-05-15T10:00:00.001Z')).kind, 'EXPIRED');
});

test('P03 entry point fixes the active review duration at 48 hours', () => {
    const anchor = new Date('2026-05-01T00:00:00Z');
    const result = calculateP03Timer(anchor, [], new Date(anchor.getTime() + 47 * HOUR));
    assert.equal(result.kind, 'RUNNING');
    if (result.kind === 'RUNNING') assert.equal(result.deadline.getTime(), anchor.getTime() + 48 * HOUR);
});

test('P16 allows one 24h evidence request with an inclusive deadline only', () => {
    const requestedAt = new Date('2026-05-01T00:00:00Z');
    assert.equal(evaluateP16EvidenceWindow({ requestedAt, requestsAlreadyUsed: 0, now: new Date(requestedAt.getTime() + 24 * HOUR) }).kind, 'ALLOWED');
    assert.equal(evaluateP16EvidenceWindow({ requestedAt, requestsAlreadyUsed: 1, now: requestedAt }).kind, 'ALREADY_USED');
    assert.equal(evaluateP16EvidenceWindow({ requestedAt, requestsAlreadyUsed: 0, now: new Date(requestedAt.getTime() + 24 * HOUR + 1) }).kind, 'EXPIRED');
});
