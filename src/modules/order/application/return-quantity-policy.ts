export interface ActiveRequestRepository {
    /** Must be atomic (unique index/CAS) on orderItemId. */
    createIfAbsent(orderItemId: string, requestId: string): Promise<boolean>;
}

export type ActiveRequestResult = { kind: 'CREATED' } | { kind: 'CONFLICT'; statusCode: 409 };

export async function createActiveReturnRequest(
    repository: ActiveRequestRepository,
    orderItemId: string,
    requestId: string,
): Promise<ActiveRequestResult> {
    if (!orderItemId.trim() || !requestId.trim()) return { kind: 'CONFLICT', statusCode: 409 };
    const created = await repository.createIfAbsent(orderItemId, requestId);
    return created ? { kind: 'CREATED' } : { kind: 'CONFLICT', statusCode: 409 };
}

export type QuantityValidation = { kind: 'VALID'; remaining: number } | { kind: 'INVALID'; reason: string };

export function validateRequestedQuantity(input: {
    requested: number;
    ordered: number;
    alreadyReplaced?: number;
    alreadyRefunded?: number;
    activeReserved?: number;
}): QuantityValidation {
    const { requested, ordered } = input;
    const alreadyReplaced = input.alreadyReplaced ?? 0;
    const alreadyRefunded = input.alreadyRefunded ?? 0;
    const activeReserved = input.activeReserved ?? 0;
    const counts = [ordered, alreadyReplaced, alreadyRefunded, activeReserved];
    if (!Number.isInteger(requested) || requested < 1 || counts.some(value => !Number.isInteger(value) || value < 0) || ordered < 1) {
        return { kind: 'INVALID', reason: 'Số lượng phải là số nguyên dương hợp lệ.' };
    }
    const remaining = ordered - alreadyReplaced - alreadyRefunded - activeReserved;
    if (remaining < 0 || requested > remaining) return { kind: 'INVALID', reason: 'Số lượng vượt quá phần item còn khả dụng.' };
    return { kind: 'VALID', remaining };
}

export interface ExchangeQuotaRepository {
    /** Atomically distinguish a retry for the same replacement from a second replacement. */
    consumeOnce(orderItemId: string, requestId: string): Promise<'CONSUMED' | 'SAME_REQUEST' | 'CONFLICT'>;
}

export type ExchangeQuotaResult = { kind: 'CONSUMED' } | { kind: 'ALREADY_CONSUMED'; statusCode: 409 };

export async function markReplacementCreated(
    repository: ExchangeQuotaRepository,
    orderItemId: string,
    requestId: string,
): Promise<ExchangeQuotaResult> {
    if (!orderItemId.trim() || !requestId.trim()) return { kind: 'ALREADY_CONSUMED', statusCode: 409 };
    const result = await repository.consumeOnce(orderItemId, requestId);
    return result === 'CONSUMED' || result === 'SAME_REQUEST'
        ? { kind: 'CONSUMED' }
        : { kind: 'ALREADY_CONSUMED', statusCode: 409 };
}
