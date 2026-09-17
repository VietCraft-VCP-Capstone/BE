import querystring from 'querystring';
import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';
import { formatVnpayDate, sortObject, createHmacSha512, stringifyParams } from '../utils/vnpay.util';
import {
    CreatePaymentUrlDto,
    VNPayIpnResponse,
    VNPayRefundInput,
    VNPayRefundResult,
    VNPayReturnResult,
} from '../types/vnpay.types';
import { Order, IOrder } from '../../order/infrastructure/models/order.model';
import { Transaction } from '../../order/infrastructure/models/transaction.model';
import { byCodeOrId, num, dec } from '../../order/utils';
import { dispatchToPrinter } from '../../order/application/printer-dispatch.service';
import { notificationService } from '../../notification';
import { Shop } from '../../product/infrastructure/models/shop.model';

export class VNPayService {
    private readonly tmnCode: string;
    private readonly hashSecret: string;
    private readonly vnpUrl: string;
    private readonly apiUrl: string;
    private readonly returnUrl: string;

    constructor() {
        this.tmnCode = config.vnpay.tmnCode;
        this.hashSecret = config.vnpay.hashSecret;
        this.vnpUrl = config.vnpay.url;
        this.apiUrl = config.vnpay.apiUrl;
        this.returnUrl = config.vnpay.returnUrl;
    }

    /**
     * Tính tổng tiền thực tế của đơn hàng từ financial_breakdown
     */
    private calculateOrderTotal(order: IOrder): number {
        const subtotal = num(order.financial_breakdown?.subtotal);
        const shippingFee = num(order.financial_breakdown?.shipping_fee);
        const discount = num(order.financial_breakdown?.coupon_discount);
        return Math.max(0, subtotal + shippingFee - discount);
    }

    /**
     * Tạo URL thanh toán VNPay chuẩn v2.1.0
     */
    async createPaymentUrl(dto: CreatePaymentUrlDto): Promise<string> {
        const order = await Order.findOne(byCodeOrId(dto.orderId));
        if (!order) {
            throw new Error(`Đơn hàng không tồn tại: ${dto.orderId}`);
        }

        if (order.payment_status === 'PAID') {
            throw new Error('Đơn hàng đã được thanh toán thành công trước đó.');
        }

        const totalAmount = this.calculateOrderTotal(order);
        if (totalAmount <= 0) {
            throw new Error('Số tiền đơn hàng không hợp lệ (phải lớn hơn 0).');
        }

        const createDate = formatVnpayDate(new Date());
        const orderInfo = `Thanh toan don hang VietCraft #${order.order_code}`;

        const vnpParams: Record<string, any> = {
            vnp_Version: '2.1.0',
            vnp_Command: 'pay',
            vnp_TmnCode: this.tmnCode,
            vnp_Locale: 'vn',
            vnp_CurrCode: 'VND',
            vnp_TxnRef: order.order_code,
            vnp_OrderInfo: orderInfo,
            vnp_OrderType: 'other',
            vnp_Amount: Math.round(totalAmount * 100), // VNPay yêu cầu nhân 100
            vnp_ReturnUrl: dto.returnUrl || this.returnUrl,
            vnp_IpAddr: dto.clientIp || '127.0.0.1',
            vnp_CreateDate: createDate,
        };

        if (dto.bankCode) {
            vnpParams['vnp_BankCode'] = dto.bankCode;
        }

        // 1. Sắp xếp params theo thứ tự alphabet A-Z
        const sortedParams = sortObject(vnpParams);

        // 2. Tạo chuỗi ký
        const signData = stringifyParams(sortedParams);

        // 3. Tạo HMAC SHA512 hash
        const secureHash = createHmacSha512(this.hashSecret, signData);

        // 4. Ghép URL hoàn chỉnh
        const paymentUrl = `${this.vnpUrl}?${signData}&vnp_SecureHash=${secureHash}`;

        logger.info(`[VNPay] Generated payment URL for Order #${order.order_code} (Amount: ${totalAmount} VND)`);
        return paymentUrl;
    }

    /**
     * Xử lý Webhook IPN từ VNPay (Chống Race Condition & Idempotent)
     */
    async handleIpn(query: Record<string, any>): Promise<VNPayIpnResponse> {
        try {
            const secureHash = query['vnp_SecureHash'];
            if (!secureHash) {
                return { RspCode: '97', Message: 'Missing checksum' };
            }

            // 1. Lọc bỏ vnp_SecureHash và vnp_SecureHashType để verify
            const vnpParams: Record<string, any> = { ...query };
            delete vnpParams['vnp_SecureHash'];
            delete vnpParams['vnp_SecureHashType'];

            // 2. Sắp xếp params
            const sortedParams = sortObject(vnpParams);
            const signData = stringifyParams(sortedParams);

            // 3. Kiểm tra chữ ký bảo mật
            const checkHash = createHmacSha512(this.hashSecret, signData);
            if (secureHash.toLowerCase() !== checkHash.toLowerCase()) {
                logger.warn(`[VNPay IPN] Checksum verification failed for TxnRef: ${query['vnp_TxnRef']}`);
                return { RspCode: '97', Message: 'Checksum failed' };
            }

            const orderCode = query['vnp_TxnRef'];
            const vnpAmount = Number(query['vnp_Amount']) / 100;
            const responseCode = query['vnp_ResponseCode'];
            const transactionNo = query['vnp_TransactionNo'];
            const bankCode = query['vnp_BankCode'];
            const payDateStr = query['vnp_PayDate'];

            // 4. Tìm Order trong database
            const order = await Order.findOne({ order_code: orderCode });
            if (!order) {
                logger.warn(`[VNPay IPN] Order not found: ${orderCode}`);
                return { RspCode: '01', Message: 'Order not found' };
            }

            // 5. Kiểm tra tính toàn vẹn của số tiền (Amount check)
            const expectedAmount = this.calculateOrderTotal(order);
            if (Math.round(expectedAmount) !== Math.round(vnpAmount)) {
                logger.warn(`[VNPay IPN] Invalid amount for ${orderCode}. Expected: ${expectedAmount}, Received: ${vnpAmount}`);
                return { RspCode: '04', Message: 'Invalid amount' };
            }

            // 6. Kiểm tra Idempotency: Nếu trạng thái đã khác PENDING -> đã xử lý rồi
            if (order.payment_status !== 'PENDING') {
                return { RspCode: '02', Message: 'Order already confirmed' };
            }

            // 7. Xử lý trạng thái giao dịch
            if (responseCode === '00') {
                // Giao dịch thành công -> Sử dụng Atomic Update
                const updatedOrder = await Order.findOneAndUpdate(
                    { order_code: orderCode, payment_status: 'PENDING' },
                    {
                        $set: {
                            payment_status: 'PAID',
                            order_status: 'PROCESSING'
                        },
                        $push: {
                            status_history: {
                                status: 'PROCESSING',
                                changed_at: new Date(),
                                note: `VNPay IPN: Thanh toán thành công (Mã GD: ${transactionNo})`
                            }
                        }
                    },
                    { new: true }
                ).populate('shop_id');

                // Nếu không cập nhật được do race condition (tiến trình khác vừa xong)
                if (!updatedOrder) {
                    return { RspCode: '02', Message: 'Order already confirmed' };
                }

                // Ghi nhận lịch sử giao dịch (Transaction)
                await Transaction.create({
                    order_id: updatedOrder._id,
                    order_code: updatedOrder.order_code,
                    user_id: updatedOrder.buyer_id,
                    gateway: 'VNPAY',
                    gateway_transaction_id: transactionNo,
                    gateway_bank_code: bankCode,
                    gateway_response_code: responseCode,
                    amount: dec(vnpAmount),
                    type: 'PAYMENT',
                    status: 'SUCCESS',
                    payment_date: payDateStr ? new Date() : undefined,
                    callback_payload: query,
                    note: `Thanh toán thành công qua VNPay #${transactionNo}`
                });

                // Đẩy đơn tự động sang nhà xưởng in ấn (POD)
                dispatchToPrinter(updatedOrder).catch((err: any) =>
                    logger.error(`[VNPay Dispatch] Lỗi gửi đơn sang xưởng in: ${err?.message || err}`)
                );

                // Gửi thông báo Realtime cho Người mua & Người bán
                try {
                    await notificationService.createNotification({
                        user_id: updatedOrder.buyer_id.toString(),
                        type: 'ORDER_UPDATE',
                        title: 'Thanh toán thành công',
                        content: `Đơn hàng #${updatedOrder.order_code} đã thanh toán thành công qua VNPay và chuyển sang xưởng sản xuất.`,
                        link: `/orders/${updatedOrder._id}`,
                        metadata: { orderId: updatedOrder._id.toString(), orderCode: updatedOrder.order_code, status: 'PROCESSING' }
                    });

                    if (updatedOrder.shop_id) {
                        const shop = await Shop.findById(updatedOrder.shop_id);
                        if (shop?.owner_id) {
                            await notificationService.createNotification({
                                user_id: shop.owner_id.toString(),
                                type: 'ORDER_UPDATE',
                                title: 'Đơn hàng mới đã thanh toán',
                                content: `Đơn hàng #${updatedOrder.order_code} (${vnpAmount.toLocaleString('vi-VN')}₫) đã được thanh toán qua VNPay.`,
                                link: `/seller/orders`,
                                metadata: { orderId: updatedOrder._id.toString(), orderCode: updatedOrder.order_code }
                            });
                        }
                    }
                } catch (notiErr: any) {
                    logger.error(`[VNPay IPN] Lỗi tạo thông báo: ${notiErr.message}`);
                }

                logger.info(`[VNPay IPN] Successfully processed payment for Order #${orderCode}`);
                return { RspCode: '00', Message: 'Confirm Success' };
            } else {
                // Giao dịch thất bại hoặc khách hàng huỷ thanh toán
                await Order.findOneAndUpdate(
                    { order_code: orderCode, payment_status: 'PENDING' },
                    {
                        $set: {
                            order_status: 'CANCELLED'
                        },
                        $push: {
                            status_history: {
                                status: 'CANCELLED',
                                changed_at: new Date(),
                                note: `VNPay IPN: Thanh toán thất bại hoặc người dùng huỷ (Response Code: ${responseCode})`
                            }
                        }
                    }
                );

                await Transaction.create({
                    order_id: order._id,
                    order_code: order.order_code,
                    user_id: order.buyer_id,
                    gateway: 'VNPAY',
                    gateway_transaction_id: transactionNo,
                    gateway_bank_code: bankCode,
                    gateway_response_code: responseCode,
                    amount: dec(vnpAmount),
                    type: 'PAYMENT',
                    status: 'FAILED',
                    callback_payload: query,
                    note: `Thanh toán thất bại qua VNPay (Code: ${responseCode})`
                });

                logger.info(`[VNPay IPN] Payment failed for Order #${orderCode} (ResponseCode: ${responseCode})`);
                return { RspCode: '00', Message: 'Confirm Success' };
            }
        } catch (error: any) {
            logger.error(`[VNPay IPN] Exception: ${error.message}`);
            return { RspCode: '99', Message: 'Unknown error' };
        }
    }

    /**
     * Kiểm tra tính hợp lệ của Return URL khi người dùng redirect về từ VNPay
     */
    verifyReturnUrl(query: Record<string, any>): VNPayReturnResult {
        const secureHash = query['vnp_SecureHash'];
        const vnpParams: Record<string, any> = { ...query };
        delete vnpParams['vnp_SecureHash'];
        delete vnpParams['vnp_SecureHashType'];

        const sortedParams = sortObject(vnpParams);
        const signData = stringifyParams(sortedParams);
        const checkHash = createHmacSha512(this.hashSecret, signData);

        const isChecksumValid = secureHash && secureHash.toLowerCase() === checkHash.toLowerCase();
        const responseCode = query['vnp_ResponseCode'] || '';
        const isSuccess = isChecksumValid && responseCode === '00';

        return {
            isSuccess,
            message: !isChecksumValid
                ? 'Chữ ký giao dịch không hợp lệ'
                : isSuccess
                    ? 'Thanh toán thành công'
                    : 'Giao dịch không thành công hoặc đã bị huỷ',
            orderCode: query['vnp_TxnRef'] || '',
            amount: Number(query['vnp_Amount'] || 0) / 100,
            transactionNo: query['vnp_TransactionNo'],
            bankCode: query['vnp_BankCode'],
            responseCode,
        };
    }

    /**
     * Gọi API Hoàn tiền (Refund) của VNPay
     */
    async refundOrder(input: VNPayRefundInput): Promise<VNPayRefundResult> {
        const order = await Order.findOne(byCodeOrId(input.orderId));
        if (!order) {
            throw new Error(`Không tìm thấy đơn hàng: ${input.orderId}`);
        }

        if (order.payment_status !== 'PAID') {
            throw new Error(`Chỉ có thể hoàn tiền cho đơn hàng đã thanh toán thành công (Trạng thái hiện tại: ${order.payment_status})`);
        }

        // Tìm giao dịch gốc để lấy vnp_TransactionNo và ngày thanh toán
        const originalTx = await Transaction.findOne({
            order_id: order._id,
            type: 'PAYMENT',
            status: 'SUCCESS'
        }).sort({ created_at: -1 });

        if (!originalTx || !originalTx.gateway_transaction_id) {
            throw new Error('Không tìm thấy mã giao dịch gốc của VNPay (vnp_TransactionNo) để yêu cầu hoàn tiền');
        }

        const orderTotal = this.calculateOrderTotal(order);
        const refundAmount = input.amount && input.amount > 0 ? input.amount : orderTotal;
        const transactionType = refundAmount >= orderTotal ? '02' : '03'; // '02': Toàn phần, '03': Một phần

        const requestId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const createDate = formatVnpayDate(new Date());
        const transactionDate = originalTx.callback_payload?.['vnp_PayDate'] || formatVnpayDate(originalTx.created_at);
        const orderInfo = input.reason || `Hoan tien don hang VietCraft #${order.order_code}`;
        const ipAddr = input.clientIp || '127.0.0.1';
        const vnp_Amount = Math.round(refundAmount * 100);

        // CẤU TRÚC KÝ BẮT BUỘC CỦA VNPAY REFUND API (Nối chuỗi bằng dấu '|')
        const signData = [
            requestId,
            '2.1.0',
            'refund',
            this.tmnCode,
            transactionType,
            order.order_code,
            vnp_Amount,
            originalTx.gateway_transaction_id,
            transactionDate,
            input.createdBy || 'Admin',
            createDate,
            ipAddr,
            orderInfo
        ].join('|');

        const secureHash = createHmacSha512(this.hashSecret, signData);

        const requestBody = {
            vnp_RequestId: requestId,
            vnp_Version: '2.1.0',
            vnp_Command: 'refund',
            vnp_TmnCode: this.tmnCode,
            vnp_TransactionType: transactionType,
            vnp_TxnRef: order.order_code,
            vnp_Amount: vnp_Amount,
            vnp_OrderInfo: orderInfo,
            vnp_TransactionNo: originalTx.gateway_transaction_id,
            vnp_TransactionDate: transactionDate,
            vnp_CreateBy: input.createdBy || 'Admin',
            vnp_CreateDate: createDate,
            vnp_IpAddr: ipAddr,
            vnp_SecureHash: secureHash
        };

        logger.info(`[VNPay Refund] Sending refund request for Order #${order.order_code} (Amount: ${refundAmount} VND)`);

        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        const data = (await response.json()) as Record<string, any>;
        logger.info(`[VNPay Refund] Response:`, data);

        if (data.vnp_ResponseCode === '00') {
            // Cập nhật trạng thái đơn hàng sang REFUNDED
            await Order.findByIdAndUpdate(order._id, {
                $set: {
                    payment_status: 'REFUNDED',
                    order_status: 'CANCELLED'
                },
                $push: {
                    status_history: {
                        status: 'CANCELLED',
                        changed_at: new Date(),
                        note: `VNPay Refund: Hoàn tiền thành công (${refundAmount.toLocaleString('vi-VN')}₫). Lý do: ${orderInfo}`
                    }
                }
            });

            // Ghi nhận Transaction REFUND
            await Transaction.create({
                order_id: order._id,
                order_code: order.order_code,
                user_id: order.buyer_id,
                gateway: 'VNPAY',
                gateway_transaction_id: data.vnp_TransactionNo || originalTx.gateway_transaction_id,
                gateway_response_code: data.vnp_ResponseCode,
                amount: dec(refundAmount),
                type: 'REFUND',
                status: 'SUCCESS',
                refund_request_id: requestId,
                callback_payload: data,
                note: `Hoàn tiền thành công: ${orderInfo}`
            });

            return {
                success: true,
                message: 'Yêu cầu hoàn tiền thành công',
                data
            };
        } else {
            // Ghi nhận Transaction REFUND FAILED
            await Transaction.create({
                order_id: order._id,
                order_code: order.order_code,
                user_id: order.buyer_id,
                gateway: 'VNPAY',
                gateway_response_code: data.vnp_ResponseCode,
                amount: dec(refundAmount),
                type: 'REFUND',
                status: 'FAILED',
                refund_request_id: requestId,
                callback_payload: data,
                note: `Hoàn tiền thất bại: ${data.vnp_Message || data.vnp_ResponseCode}`
            });

            throw new Error(`VNPay Refund thất bại [Mã lỗi ${data.vnp_ResponseCode}]: ${data.vnp_Message || 'Từ chối giao dịch'}`);
        }
    }
}

export const vnpayService = new VNPayService();
