export interface CreatePayosPaymentDto {
    orderId: string;
    buyerId?: string;
}

export interface PayosPaymentResult {
    checkoutUrl: string;
    qrCode?: string;
    paymentLinkId: string;
    expiredAt?: number;
}

export type PayosWebhookOutcome = 'INVALID_SIGNATURE' | 'IGNORED' | 'PROCESSED';
