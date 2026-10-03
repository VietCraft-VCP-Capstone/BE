export type ReturnActor = 'BUYER' | 'SELLER' | 'PRINTER' | 'ADMIN' | 'SYSTEM';
export type ReturnActorAction =
    | 'BUYER_SUBMIT' | 'BUYER_VIEW' | 'BUYER_ADD_EVIDENCE' | 'BUYER_DISPUTE' | 'BUYER_CANCEL'
    | 'SELLER_VIEW' | 'SELLER_ADD_EVIDENCE' | 'SELLER_APPEAL'
    | 'SELLER_APPROVE' | 'SELLER_REJECT' | 'SELLER_ASSIGN_FAULT'
    | 'PRINTER_VIEW' | 'PRINTER_ADD_EVIDENCE' | 'PRINTER_APPROVE' | 'PRINTER_REJECT' | 'PRINTER_REQUEST_EVIDENCE' | 'PRINTER_PROPOSE_FAULT_CHANGE' | 'PRINTER_CONFIRM_FAULT_CHANGE' | 'PRINTER_ASSIGN_FAULT'
    | 'ADMIN_VIEW' | 'ADMIN_FINALIZE' | 'ADMIN_CORRECT'
    | 'SYSTEM_TRANSITION';

export interface ReturnActorContext {
    actor: ReturnActor;
    userId?: string | null;
    orderOwnedByBuyer?: boolean;
    sellerOwnsRequest?: boolean;
    assignedPrinter?: boolean;
    faultSellerId?: string | null;
    appealUsed?: boolean;
    correctionCount?: number;
    sideEffectStarted?: boolean;
    isPOD?: boolean;
    scope?: 'POD' | 'NORMAL' | 'PHYSICAL_RETURN';
}

export type ReturnActorDecision = { allowed: true } | { allowed: false; reason: string };
const allow = (): ReturnActorDecision => ({ allowed: true });
const deny = (reason: string): ReturnActorDecision => ({ allowed: false, reason });

export function canReturnActorPerform(action: ReturnActorAction, context: ReturnActorContext): ReturnActorDecision {
    const isExplicitPOD = context.scope === 'POD' || context.isPOD === true;
    if (!isExplicitPOD || context.scope === 'NORMAL' || context.scope === 'PHYSICAL_RETURN' || context.isPOD === false) {
        return deny('EXCHANGE_NORMAL_DISABLED');
    }
    if (action.startsWith('BUYER_') && context.actor === 'BUYER') {
        if (context.orderOwnedByBuyer !== true) return deny('BUYER_ORDER_OWNERSHIP_REQUIRED');
        return ['BUYER_SUBMIT', 'BUYER_VIEW', 'BUYER_ADD_EVIDENCE', 'BUYER_DISPUTE', 'BUYER_CANCEL'].includes(action)
            ? allow() : deny('ACTION_NOT_ALLOWED');
    }
    if (action.startsWith('SELLER_') && context.actor === 'SELLER') {
        if (context.sellerOwnsRequest !== true) return deny('SELLER_REQUEST_OWNERSHIP_REQUIRED');
        if (action === 'SELLER_VIEW' || action === 'SELLER_ADD_EVIDENCE') return allow();
        if (action === 'SELLER_APPEAL') {
            if (!context.userId || !context.faultSellerId || context.userId !== context.faultSellerId) return deny('ONLY_ASSIGNED_FAULT_SELLER_MAY_APPEAL');
            if (context.appealUsed) return deny('SELLER_APPEAL_ALREADY_USED');
            return allow();
        }
        return deny('SELLER_CANNOT_DECIDE_OR_ASSIGN_FAULT');
    }
    if (action.startsWith('PRINTER_') && context.actor === 'PRINTER') {
        if (context.assignedPrinter !== true) return deny('ASSIGNED_PRINTER_REQUIRED');
        if (['PRINTER_VIEW', 'PRINTER_ADD_EVIDENCE', 'PRINTER_APPROVE', 'PRINTER_REJECT', 'PRINTER_REQUEST_EVIDENCE', 'PRINTER_PROPOSE_FAULT_CHANGE'].includes(action)) return allow();
        if (action === 'PRINTER_CONFIRM_FAULT_CHANGE') return deny('ADMIN_MUST_CONFIRM_FAULT_CHANGE');
        return deny('PRINTER_CANNOT_ASSIGN_FAULT_OR_FINALIZE_ADMIN_DECISION');
    }
    if (action.startsWith('ADMIN_') && context.actor === 'ADMIN') {
        if (action === 'ADMIN_VIEW' || action === 'ADMIN_FINALIZE') return allow();
        if (action === 'ADMIN_CORRECT') {
            if (context.sideEffectStarted) return deny('CORRECTION_FORBIDDEN_AFTER_SIDE_EFFECT');
            if ((context.correctionCount ?? 0) >= 1) return deny('ADMIN_CORRECTION_ALREADY_USED');
            return allow();
        }
        return deny('ACTION_NOT_ALLOWED');
    }
    if (action === 'SYSTEM_TRANSITION' && context.actor === 'SYSTEM') return allow();
    return deny('ACTOR_ACTION_MISMATCH');
}
