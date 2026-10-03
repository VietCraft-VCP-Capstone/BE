export type RefundStatus =
    | 'PENDING_SELLER' | 'SELLER_APPROVED' | 'SELLER_REJECTED'
    | 'PENDING_PRINTER' | 'PRINTER_APPROVED' | 'PRINTER_REJECTED'
    | 'DISPUTED' | 'ADMIN_APPROVED' | 'ADMIN_REJECTED'
    | 'REFUNDED' | 'TIMEOUT_ESCALATED';

export type RefundActor = 'buyer-dispute' | 'seller-dispute' | 'seller-triage' | 'seller-decision'
    | 'printer-response' | 'admin-resolve' | 'timeout' | 'refund-execution';

const transitions: Record<RefundActor, Partial<Record<RefundStatus, RefundStatus[]>>> = {
    'buyer-dispute': { SELLER_REJECTED: ['DISPUTED'], PRINTER_APPROVED: ['DISPUTED'], PRINTER_REJECTED: ['DISPUTED'], TIMEOUT_ESCALATED: ['DISPUTED'] },
    'seller-dispute': {},
    'seller-triage': {},
    'seller-decision': { PENDING_SELLER: ['SELLER_APPROVED', 'SELLER_REJECTED'] },
    'printer-response': { PENDING_PRINTER: ['PRINTER_APPROVED', 'PRINTER_REJECTED'] },
    'admin-resolve': { DISPUTED: ['ADMIN_APPROVED', 'ADMIN_REJECTED'] },
    'timeout': { PENDING_SELLER: ['TIMEOUT_ESCALATED'], PENDING_PRINTER: ['DISPUTED'] },
    'refund-execution': { SELLER_APPROVED: ['REFUNDED'], PRINTER_APPROVED: ['REFUNDED'], ADMIN_APPROVED: ['REFUNDED'] },
};

export class RefundStateMachine {
    static canTransition(from: RefundStatus, actor: RefundActor, to: RefundStatus): boolean {
        return transitions[actor][from]?.includes(to) ?? false;
    }

    static assertTransition(from: RefundStatus, actor: RefundActor, to: RefundStatus): void {
        if (!this.canTransition(from, actor, to)) {
            throw new Error(`Chuyển trạng thái refund không hợp lệ: ${from} -> ${to} (${actor})`);
        }
    }
}
