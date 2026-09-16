export interface CreatePaymentUrlDto {
    orderId: string;
    clientIp?: string;
    bankCode?: string;
    returnUrl?: string;
}

export interface VNPayIpnResponse {
    RspCode: string;
    Message: string;
}

export interface VNPayRefundInput {
    orderId: string;
    amount?: number;
    reason: string;
    createdBy: string;
    clientIp?: string;
}

export interface VNPayRefundResult {
    success: boolean;
    message: string;
    data?: Record<string, any>;
}

export interface VNPayReturnResult {
    isSuccess: boolean;
    message: string;
    orderCode: string;
    amount: number;
    transactionNo?: string;
    bankCode?: string;
    responseCode: string;
}
