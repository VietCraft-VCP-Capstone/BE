import mongoose from 'mongoose';
import { ReturnRefundExecution } from '../models/return-refund-execution.model';
import type { LinkedRefundExecution, LinkedRefundExecutionRepository, LinkedRefundInput } from '../../application/return-refund-bridge.service';

function isDuplicateKeyError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000;
}

function toExecution(doc: any): LinkedRefundExecution {
    return {
        id: String(doc._id),
        requestId: doc.request_id,
        orderItemId: doc.order_item_id,
        orderId: doc.order_id,
        resolution: doc.resolution,
        faultParty: doc.fault_party,
        amountMinor: doc.amount_minor,
        currency: doc.currency,
        adminDecisionId: doc.admin_decision_id,
        status: 'PENDING_INTEGRATION',
    };
}

export class MongooseReturnRefundExecutionRepository implements LinkedRefundExecutionRepository {
    async findByBusinessKey(requestId: string, orderItemId: string): Promise<LinkedRefundExecution | null> {
        const doc = await ReturnRefundExecution.findOne({ request_id: requestId, order_item_id: orderItemId }).lean();
        return doc ? toExecution(doc) : null;
    }

    async createPending(input: LinkedRefundInput): Promise<LinkedRefundExecution> {
        try {
            const [doc] = await ReturnRefundExecution.create([{
                request_id: input.requestId,
                order_item_id: input.orderItemId,
                order_id: input.orderId,
                resolution: 'REFUND',
                fault_party: input.faultParty,
                amount_minor: input.amountMinor,
                currency: input.currency,
                admin_decision_id: input.adminDecisionId,
                status: 'PENDING_INTEGRATION',
            }]);
            return toExecution(doc);
        } catch (error) {
            if (!isDuplicateKeyError(error)) throw error;
            const existing = await this.findByBusinessKey(input.requestId, input.orderItemId);
            if (existing) return existing;
            throw error;
        }
    }
}

export function isMongoDuplicateKey(error: unknown): boolean {
    return isDuplicateKeyError(error) || error instanceof mongoose.mongo.MongoServerError && error.code === 11000;
}
