import { RefundExecutionService, type RefundExecutionInput } from './refund-execution.service';
import { MongoRefundExecutionRepository } from '../infrastructure/refund-execution.repository';
import { VNPayRefundGateway } from './vnpay-refund.gateway';
import { PayosRefundGateway } from './payos-refund.gateway';
import { MethodRoutingRefundGateway } from './payment-refund.gateway';

export const refundExecutionService = new RefundExecutionService(
    new MongoRefundExecutionRepository(),
    new MethodRoutingRefundGateway({ VNPAY: new VNPayRefundGateway(), PAYOS: new PayosRefundGateway() }),
);
/** Hoàn tiền qua gateway tương ứng phương thức thanh toán của đơn (VNPay hoặc payOS). */
export const executeRefund = (input: RefundExecutionInput) => refundExecutionService.execute(input);
export const executeVnpayRefund = executeRefund;
