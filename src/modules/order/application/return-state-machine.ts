export type ReturnScope = 'POD' | 'NORMAL' | 'PHYSICAL_RETURN';
export type ReturnState =
    | 'DRAFT'
    | 'SUBMITTED'
    | 'PENDING_PRINTER'
    | 'PRINTER_PROPOSED_APPROVAL'
    | 'PRINTER_PROPOSED_REJECTION'
    | 'PRINTER_PROPOSED_FAULT_CHANGE'
    | 'APPROVED'
    | 'REJECTED'
    | 'DISPUTED'
    | 'ADMIN_REJECTED'
    | 'WAITING_BUYER_CHOICE'
    | 'AWAITING_ADMIN_REFUND'
    | 'WAITING_STOCK'
    | 'WAITING_RETURN'
    | 'RETURN_RECEIVED'
    | 'RETURN_FAILED'
    | 'REPLACEMENT_CREATED'
    | 'CONVERTED_TO_REFUND'
    | 'COMPLETED'
    | 'EXPIRED'
    | 'CANCELLED';

export type ReturnActor = 'BUYER' | 'SELLER' | 'PRINTER' | 'ADMIN' | 'SYSTEM';
export type ReturnAction =
    | 'BUYER_SUBMIT'
    | 'ELIGIBILITY_PASSED'
    | 'ADMIN_REVIEW_REQUIRED'
    | 'PRINTER_APPROVE'
    | 'PRINTER_REJECT'
    | 'PRINTER_PROPOSE_APPROVAL'
    | 'PRINTER_PROPOSE_REJECTION'
    | 'PRINTER_PROPOSE_FAULT_CHANGE'
    | 'ADMIN_CONFIRM_FAULT_CHANGE'
    | 'PRINTER_SET_FAULT'
    | 'ADMIN_CONFIRM_REFUND'
    | 'PRINTER_CONFIRM_REFUND'
    | 'BUYER_DISPUTE'
    | 'ADMIN_CORRECT'
    | 'ADMIN_CORRECT_REFUND'
    | 'ADMIN_CORRECT_EXCHANGE'
    | 'ADMIN_APPROVE'
    | 'ADMIN_REJECT'
    | 'ADMIN_CONFIRM_PROPOSAL'
    | 'BUYER_CANCEL'
    | 'PRINTER_TIMEOUT'
    | 'STOCK_UNAVAILABLE'
    | 'BUYER_CHOOSE_WAIT'
    | 'BUYER_CHOOSE_REFUND'
    | 'BUYER_CHOICE_EXPIRED'
    | 'STOCK_AVAILABLE'
    | 'STOCK_WAIT_EXPIRED'
    | 'BUYER_RETURN_START'
    | 'PRINTER_RETURN_RECEIVED'
    | 'PRINTER_RETURN_FAILED'
    | 'RETURN_WINDOW_EXPIRED'
    | 'REPLACEMENT_CREATE'
    | 'REPLACEMENT_COMPLETED'
    | 'EXCHANGE_TO_REFUND'
    | 'CANCEL';

export interface ReturnTransitionContext {
    scope: ReturnScope;
    actor: ReturnActor;
    exchange_normal_enabled?: boolean;
    disputeCount?: number;
    waitCount?: number;
    now?: Date;
    deadline?: Date;
    sideEffectStarted?: boolean;
}

export type TransitionResult = true | false | { allowed: false; reason: 'EXCHANGE_NORMAL_DISABLED' };

interface TransitionRule {
    from: ReturnState;
    action: ReturnAction;
    to: ReturnState;
    actor: ReturnActor;
    allowSideEffect?: boolean;
}

const podTransitions: readonly TransitionRule[] = [
    { from: 'DRAFT', action: 'BUYER_SUBMIT', to: 'SUBMITTED', actor: 'BUYER' },
    { from: 'SUBMITTED', action: 'ELIGIBILITY_PASSED', to: 'PENDING_PRINTER', actor: 'SYSTEM' },
    { from: 'SUBMITTED', action: 'ADMIN_REVIEW_REQUIRED', to: 'DISPUTED', actor: 'SYSTEM' },
    { from: 'PENDING_PRINTER', action: 'PRINTER_APPROVE', to: 'APPROVED', actor: 'PRINTER' },
    { from: 'PENDING_PRINTER', action: 'PRINTER_APPROVE', to: 'AWAITING_ADMIN_REFUND', actor: 'PRINTER' },
    { from: 'PENDING_PRINTER', action: 'PRINTER_REJECT', to: 'REJECTED', actor: 'PRINTER' },
    { from: 'PENDING_PRINTER', action: 'PRINTER_PROPOSE_FAULT_CHANGE', to: 'PRINTER_PROPOSED_FAULT_CHANGE', actor: 'PRINTER' },
    { from: 'PRINTER_PROPOSED_FAULT_CHANGE', action: 'ADMIN_CONFIRM_FAULT_CHANGE', to: 'APPROVED', actor: 'ADMIN' },
    { from: 'PRINTER_PROPOSED_FAULT_CHANGE', action: 'ADMIN_CONFIRM_REFUND', to: 'CONVERTED_TO_REFUND', actor: 'ADMIN' },
    { from: 'PRINTER_PROPOSED_FAULT_CHANGE', action: 'ADMIN_REJECT', to: 'ADMIN_REJECTED', actor: 'ADMIN' },
    { from: 'DISPUTED', action: 'ADMIN_CONFIRM_FAULT_CHANGE', to: 'APPROVED', actor: 'ADMIN' },
    { from: 'DISPUTED', action: 'ADMIN_CONFIRM_REFUND', to: 'CONVERTED_TO_REFUND', actor: 'ADMIN' },
    { from: 'PENDING_PRINTER', action: 'PRINTER_TIMEOUT', to: 'DISPUTED', actor: 'SYSTEM' },
    { from: 'PENDING_PRINTER', action: 'BUYER_CANCEL', to: 'CANCELLED', actor: 'BUYER' },
    { from: 'REJECTED', action: 'BUYER_DISPUTE', to: 'DISPUTED', actor: 'BUYER' },
    { from: 'APPROVED', action: 'ADMIN_CORRECT', to: 'APPROVED', actor: 'ADMIN' },
    { from: 'REJECTED', action: 'ADMIN_CORRECT', to: 'REJECTED', actor: 'ADMIN' },
    { from: 'DISPUTED', action: 'ADMIN_CORRECT', to: 'DISPUTED', actor: 'ADMIN' },
    { from: 'ADMIN_REJECTED', action: 'ADMIN_CORRECT', to: 'ADMIN_REJECTED', actor: 'ADMIN' },
    { from: 'PRINTER_PROPOSED_FAULT_CHANGE', action: 'ADMIN_CORRECT', to: 'PRINTER_PROPOSED_FAULT_CHANGE', actor: 'ADMIN' },
    { from: 'APPROVED', action: 'ADMIN_CORRECT_REFUND', to: 'CONVERTED_TO_REFUND', actor: 'ADMIN' },
    { from: 'REJECTED', action: 'ADMIN_CORRECT_REFUND', to: 'CONVERTED_TO_REFUND', actor: 'ADMIN' },
    { from: 'DISPUTED', action: 'ADMIN_CORRECT_REFUND', to: 'CONVERTED_TO_REFUND', actor: 'ADMIN' },
    { from: 'ADMIN_REJECTED', action: 'ADMIN_CORRECT_REFUND', to: 'CONVERTED_TO_REFUND', actor: 'ADMIN' },
    { from: 'PRINTER_PROPOSED_FAULT_CHANGE', action: 'ADMIN_CORRECT_REFUND', to: 'CONVERTED_TO_REFUND', actor: 'ADMIN' },
    { from: 'APPROVED', action: 'ADMIN_CORRECT_EXCHANGE', to: 'APPROVED', actor: 'ADMIN' },
    { from: 'REJECTED', action: 'ADMIN_CORRECT_EXCHANGE', to: 'APPROVED', actor: 'ADMIN' },
    { from: 'DISPUTED', action: 'ADMIN_CORRECT_EXCHANGE', to: 'APPROVED', actor: 'ADMIN' },
    { from: 'ADMIN_REJECTED', action: 'ADMIN_CORRECT_EXCHANGE', to: 'APPROVED', actor: 'ADMIN' },
    { from: 'PRINTER_PROPOSED_FAULT_CHANGE', action: 'ADMIN_CORRECT_EXCHANGE', to: 'APPROVED', actor: 'ADMIN' },
    { from: 'DISPUTED', action: 'ADMIN_APPROVE', to: 'APPROVED', actor: 'ADMIN' },
    { from: 'DISPUTED', action: 'ADMIN_REJECT', to: 'ADMIN_REJECTED', actor: 'ADMIN' },
    { from: 'PRINTER_PROPOSED_APPROVAL', action: 'ADMIN_CONFIRM_PROPOSAL', to: 'APPROVED', actor: 'ADMIN' },
    { from: 'PRINTER_PROPOSED_REJECTION', action: 'ADMIN_CONFIRM_PROPOSAL', to: 'REJECTED', actor: 'ADMIN' },
    { from: 'APPROVED', action: 'ADMIN_CONFIRM_REFUND', to: 'CONVERTED_TO_REFUND', actor: 'ADMIN' },
    { from: 'AWAITING_ADMIN_REFUND', action: 'ADMIN_CONFIRM_REFUND', to: 'CONVERTED_TO_REFUND', actor: 'ADMIN' },
    { from: 'APPROVED', action: 'STOCK_UNAVAILABLE', to: 'WAITING_BUYER_CHOICE', actor: 'SYSTEM' },
    { from: 'WAITING_BUYER_CHOICE', action: 'BUYER_CHOOSE_WAIT', to: 'WAITING_STOCK', actor: 'BUYER' },
    { from: 'WAITING_BUYER_CHOICE', action: 'BUYER_CHOOSE_REFUND', to: 'AWAITING_ADMIN_REFUND', actor: 'BUYER' },
    { from: 'WAITING_BUYER_CHOICE', action: 'BUYER_CHOICE_EXPIRED', to: 'DISPUTED', actor: 'SYSTEM' },
    { from: 'WAITING_STOCK', action: 'STOCK_AVAILABLE', to: 'APPROVED', actor: 'SYSTEM' },
    { from: 'WAITING_STOCK', action: 'STOCK_WAIT_EXPIRED', to: 'DISPUTED', actor: 'SYSTEM' },
    { from: 'WAITING_BUYER_CHOICE', action: 'STOCK_WAIT_EXPIRED', to: 'DISPUTED', actor: 'SYSTEM' },
    { from: 'WAITING_BUYER_CHOICE', action: 'BUYER_CANCEL', to: 'CANCELLED', actor: 'BUYER' },
];

// Declared for future policy clarity only. The feature flag defaults off and no L1 path enables it.
const disabledFutureTransitions: readonly TransitionRule[] = [
    { from: 'DRAFT', action: 'BUYER_SUBMIT', to: 'SUBMITTED', actor: 'BUYER' },
    { from: 'APPROVED', action: 'BUYER_RETURN_START', to: 'WAITING_RETURN', actor: 'SYSTEM' },
    { from: 'WAITING_RETURN', action: 'PRINTER_RETURN_RECEIVED', to: 'RETURN_RECEIVED', actor: 'PRINTER' },
    { from: 'WAITING_RETURN', action: 'PRINTER_RETURN_FAILED', to: 'RETURN_FAILED', actor: 'PRINTER' },
    { from: 'WAITING_RETURN', action: 'RETURN_WINDOW_EXPIRED', to: 'EXPIRED', actor: 'SYSTEM' },
    { from: 'RETURN_RECEIVED', action: 'REPLACEMENT_CREATE', to: 'REPLACEMENT_CREATED', actor: 'SYSTEM' },
    { from: 'RETURN_RECEIVED', action: 'EXCHANGE_TO_REFUND', to: 'CONVERTED_TO_REFUND', actor: 'SYSTEM' },
    { from: 'RETURN_FAILED', action: 'BUYER_DISPUTE', to: 'DISPUTED', actor: 'BUYER' },
];

const podStates = new Set<ReturnState>([
    'DRAFT', 'SUBMITTED', 'PENDING_PRINTER', 'PRINTER_PROPOSED_APPROVAL', 'PRINTER_PROPOSED_REJECTION', 'PRINTER_PROPOSED_FAULT_CHANGE', 'APPROVED', 'REJECTED', 'DISPUTED', 'ADMIN_REJECTED',
    'WAITING_BUYER_CHOICE', 'AWAITING_ADMIN_REFUND', 'WAITING_STOCK', 'REPLACEMENT_CREATED', 'CONVERTED_TO_REFUND', 'COMPLETED', 'EXPIRED', 'CANCELLED',
]);

function deadlineAllowsAction(now: Date | undefined, deadline: Date | undefined): boolean {
    if (!(deadline instanceof Date) || !Number.isFinite(deadline.getTime())) return false;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return false;
    return now.getTime() <= deadline.getTime();
}

export class ReturnStateMachine {
    static canTransition(from: ReturnState, action: ReturnAction, to: ReturnState, context: ReturnTransitionContext): TransitionResult {
        if (context.scope !== 'POD') {
            if (context.exchange_normal_enabled !== true) return { allowed: false, reason: 'EXCHANGE_NORMAL_DISABLED' };
            return false;
        }
        if (!podStates.has(from) || !podStates.has(to)) return false;
        const rule = podTransitions.find(item => item.from === from && item.action === action && item.to === to && item.actor === context.actor);
        if (rule) {
            if (action === 'PRINTER_TIMEOUT') {
                if (!(context.now instanceof Date) || !Number.isFinite(context.now.getTime()) || !(context.deadline instanceof Date) || !Number.isFinite(context.deadline.getTime()) || context.now.getTime() <= context.deadline.getTime()) return false;
            }
            if (action === 'BUYER_DISPUTE') {
                if (context.disputeCount !== undefined && context.disputeCount >= 1) return false;
                if (!deadlineAllowsAction(context.now, context.deadline)) return false;
            }
            if (action === 'BUYER_CHOOSE_WAIT' || action === 'BUYER_CHOOSE_REFUND') {
                if (!deadlineAllowsAction(context.now, context.deadline)) return false;
            }
            if (action === 'BUYER_CHOICE_EXPIRED' || action === 'STOCK_WAIT_EXPIRED') {
                if (!(context.now instanceof Date) || !Number.isFinite(context.now.getTime()) || !(context.deadline instanceof Date) || !Number.isFinite(context.deadline.getTime()) || context.now.getTime() <= context.deadline.getTime()) return false;
            }
            if (action === 'BUYER_CHOOSE_WAIT' && context.waitCount !== undefined && context.waitCount >= 1) return false;
            if (action === 'BUYER_CANCEL' && context.sideEffectStarted) return false;
            return true;
        }
        // These transitions are known but prohibited while the NORMAL/physical-return gate is off.
        const futureRule = disabledFutureTransitions.find(item => item.from === from && item.action === action && item.to === to && item.actor === context.actor);
        if (futureRule) return { allowed: false, reason: 'EXCHANGE_NORMAL_DISABLED' };
        return false;
    }

    static assertTransition(from: ReturnState, action: ReturnAction, to: ReturnState, context: ReturnTransitionContext): void {
        const result = this.canTransition(from, action, to, context);
        if (result !== true) {
            const reason = result === false ? 'INVALID_TRANSITION' : result.reason;
            throw new Error(`Return transition denied (${reason}): ${from} -> ${to} via ${action}`);
        }
    }
}
