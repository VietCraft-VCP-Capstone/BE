import { RefundExecutionService, type ManualSettlement, type RefundExecutionInput } from './refund-execution.service';
import { MongoRefundExecutionRepository } from '../infrastructure/refund-execution.repository';
import { VNPayRefundGateway } from './vnpay-refund.gateway';
import { PayosRefundGateway } from './payos-refund.gateway';
import { MethodRoutingRefundGateway } from './payment-refund.gateway';

const refundRepository = new MongoRefundExecutionRepository();
export const refundExecutionService = new RefundExecutionService(
    refundRepository,
    new MethodRoutingRefundGateway({ VNPAY: new VNPayRefundGateway(), PAYOS: new PayosRefundGateway() }),
);
/** Hoàn tiền qua gateway tương ứng phương thức thanh toán của đơn (VNPay hoặc payOS). */
export const executeRefund = (input: RefundExecutionInput) => refundExecutionService.execute(input);
export const executeVnpayRefund = executeRefund;
/** Người bán đã tự chuyển khoản hoàn: ghi nhận sau khi chắc cổng thanh toán chưa chi. */
export const settleRefundManually = (input: RefundExecutionInput, manual: ManualSettlement) => refundExecutionService.settleManually(input, manual);
/** Ngữ cảnh hoàn tiền (gồm tài khoản nhận nếu cổng cho biết), chỉ đọc. */
export const refundContextOf = (orderId: string) => refundRepository.loadContext(orderId);
