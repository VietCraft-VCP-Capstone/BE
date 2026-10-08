import type { PaymentRefundRecord } from '../infrastructure/refund-execution.model';
import type { RefundContext, RefundExecutionInput, RefundGateway, RefundGatewayResult } from './refund-execution.service';

/** Chọn gateway hoàn tiền theo phương thức đã thu tiền của đơn. */
export class MethodRoutingRefundGateway implements RefundGateway {
    constructor(private readonly gateways: Record<string, RefundGateway>) {}

    private pick(context: RefundContext): RefundGateway {
        const gateway = this.gateways[context.paymentMethod];
        if (!gateway) throw new Error(`Chưa có gateway hoàn tiền cho phương thức ${context.paymentMethod}.`);
        return gateway;
    }
    refund(context: RefundContext, record: PaymentRefundRecord, input: RefundExecutionInput): Promise<RefundGatewayResult> {
        return this.pick(context).refund(context, record, input);
    }
    query(context: RefundContext, record: PaymentRefundRecord): Promise<RefundGatewayResult> {
        return this.pick(context).query(context, record);
    }
}
