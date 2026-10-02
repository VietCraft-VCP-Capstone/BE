import mongoose from 'mongoose';
import { RefundLedgerEntry, RefundLedgerType } from '../infrastructure/models/refund-ledger.model';

export interface RefundLedgerTotals {
    paidIn: number;
    refunded: number;
    refunding: number;
    available: number;
}

export function computeLedgerTotals(sums: Partial<Record<RefundLedgerType, number>>): RefundLedgerTotals {
    const paidIn = sums.PAYMENT_IN || 0;
    const refunded = sums.REFUND_SETTLED || 0;
    const held = sums.REFUND_HOLD || 0;
    const released = sums.REFUND_RELEASED || 0;
    const refunding = held - refunded - released;
    return { paidIn, refunded, refunding, available: paidIn - refunded };
}

export class RefundLedgerService {
    static async append(input: {
        uniqueKey: string;
        orderId: mongoose.Types.ObjectId;
        refundId?: mongoose.Types.ObjectId;
        type: RefundLedgerType;
        amount: number;
        reference?: string;
    }): Promise<void> {
        await RefundLedgerEntry.updateOne(
            { unique_key: input.uniqueKey },
            {
                $setOnInsert: {
                    unique_key: input.uniqueKey,
                    order_id: input.orderId,
                    refund_id: input.refundId,
                    type: input.type,
                    amount: Math.round(input.amount),
                    reference: input.reference,
                },
            },
            { upsert: true },
        );
    }

    static async totals(orderId: mongoose.Types.ObjectId): Promise<RefundLedgerTotals> {
        const rows = await RefundLedgerEntry.aggregate<{ _id: RefundLedgerType; amount: number }>([
            { $match: { order_id: orderId } },
            { $group: { _id: '$type', amount: { $sum: '$amount' } } },
        ]);
        return computeLedgerTotals(Object.fromEntries(rows.map(row => [row._id, row.amount])));
    }

    static async assertInvariant(orderId: mongoose.Types.ObjectId): Promise<RefundLedgerTotals> {
        const totals = await this.totals(orderId);
        if (totals.refunded < 0 || totals.refunding < 0 || totals.refunded + totals.refunding > totals.paidIn) {
            throw new Error(`Refund ledger invariant violated for order ${orderId}: ${JSON.stringify(totals)}`);
        }
        return totals;
    }
}
