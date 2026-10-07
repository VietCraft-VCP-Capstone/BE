export type LinkedRefundStatus = 'PENDING_INTEGRATION' | 'PROCESSING' | 'PENDING' | 'FAILED' | 'REFUNDED';
export type LinkedRefundFaultParty = 'BUYER' | 'SELLER' | 'PRINTER' | 'CARRIER' | 'PLATFORM';

export interface LinkedRefundInput {
    requestId: string;
    orderItemId: string;
    orderId: string;
    resolution: 'REFUND' | 'EXCHANGE';
    faultParty: LinkedRefundFaultParty | null;
    amountMinor: number;
    currency: string;
    adminDecisionId: string;
    finalizedByAdmin: boolean;
}

export interface LinkedRefundExecution {
    id: string;
    requestId: string;
    orderItemId: string;
    orderId: string;
    resolution: 'REFUND';
    faultParty: LinkedRefundFaultParty;
    amountMinor: number;
    currency: string;
    adminDecisionId: string;
    status: LinkedRefundStatus;
}

export interface LinkedRefundExecutionRepository {
    findByBusinessKey(requestId: string, orderItemId: string): Promise<LinkedRefundExecution | null>;
    /** Must enforce a unique compound index on (requestId, orderItemId). */
    createPending(input: LinkedRefundInput): Promise<LinkedRefundExecution>;
}

function validateInput(input: LinkedRefundInput): void {
    if (!input.requestId.trim() || !input.orderItemId.trim() || !input.orderId.trim() || !input.adminDecisionId.trim()) {
        throw new Error('Thiếu liên kết nguồn hoặc mã quyết định Refund.');
    }
    if (!input.finalizedByAdmin) throw new Error('Chỉ tạo linked Refund sau quyết định xác nhận của Admin.');
    if (input.resolution !== 'REFUND') throw new Error('Chỉ resolution Refund được tạo linked execution.');
    if (!input.faultParty) throw new Error('Thiếu fault_party đã được Admin xác nhận.');
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) throw new Error('Số tiền Refund không hợp lệ.');
    if (!/^[A-Za-z]{3}$/.test(input.currency.trim())) throw new Error('Currency không hợp lệ.');
}

function isDuplicateKeyError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000;
}

function verifyStoredExecution(record: LinkedRefundExecution, requestId: string, orderItemId: string): LinkedRefundExecution {
    if (record.requestId !== requestId || record.orderItemId !== orderItemId || !['PENDING_INTEGRATION', 'PROCESSING', 'PENDING', 'FAILED', 'REFUNDED'].includes(record.status)) {
        throw new Error('Linked Refund repository returned a record outside the allowed business key/status.');
    }
    return record;
}

export async function createLinkedRefundExecution(
    repository: LinkedRefundExecutionRepository,
    input: LinkedRefundInput,
): Promise<LinkedRefundExecution> {
    if (!input.requestId.trim() || !input.orderItemId.trim()) throw new Error('Thiếu business key linked Refund.');
    const existing = await repository.findByBusinessKey(input.requestId, input.orderItemId);
    if (existing) return verifyStoredExecution(existing, input.requestId, input.orderItemId);
    validateInput(input);

    try {
        const created = await repository.createPending(input);
        return verifyStoredExecution(created, input.requestId, input.orderItemId);
    } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        const racedRecord = await repository.findByBusinessKey(input.requestId, input.orderItemId);
        if (racedRecord) return verifyStoredExecution(racedRecord, input.requestId, input.orderItemId);
        throw error;
    }
}
