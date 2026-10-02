export class RefundError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly reason: string,
        message?: string,
    ) {
        super(message || reason);
        this.name = 'RefundError';
    }
}

export const refundError = (reason: string, message?: string, statusCode = 422) =>
    new RefundError(statusCode, reason, message);
