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
    refundRequestId?: string;
    reason: string;
    createdBy: string;
    clientIp?: string;
    /** Mã ổn định do refund workflow cấp để đối chiếu một lần thực thi. */
    requestId?: string;
}

export interface VNPayRefundResult {
    success: boolean;
    status?: 'REFUNDED' | 'PENDING' | 'PROCESSING' | 'FAILED';
    executionId?: string;
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
