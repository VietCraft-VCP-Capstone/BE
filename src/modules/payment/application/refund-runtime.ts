import { RefundExecutionService, type RefundExecutionInput } from './refund-execution.service';
import { MongoRefundExecutionRepository } from '../infrastructure/refund-execution.repository';
import { VNPayRefundGateway } from './vnpay-refund.gateway';

export const refundExecutionService = new RefundExecutionService(new MongoRefundExecutionRepository(), new VNPayRefundGateway());
export const executeVnpayRefund = (input: RefundExecutionInput) => refundExecutionService.execute(input);
