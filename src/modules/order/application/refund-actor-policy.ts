export type RefundProductType = 'NORMAL' | 'POD';
export type RefundReviewStatus = 'PENDING_SELLER' | 'SELLER_REJECTED' | 'PENDING_PRINTER' | 'PRINTER_REJECTED' | 'TIMEOUT_ESCALATED' | string;

export function initialRefundStatus(productType: RefundProductType): 'PENDING_SELLER' | 'PENDING_PRINTER' {
    return productType === 'POD' ? 'PENDING_PRINTER' : 'PENDING_SELLER';
}

export function sellerCanActOnRefund(productType: RefundProductType): boolean {
    return productType === 'NORMAL';
}

export function buyerCanDispute(productType: RefundProductType, status: RefundReviewStatus): boolean {
    if (status === 'TIMEOUT_ESCALATED') return true;
    if (productType === 'POD') return status === 'PRINTER_REJECTED';
    return status === 'SELLER_REJECTED' || status === 'PRINTER_APPROVED' || status === 'PRINTER_REJECTED';
}
