import mongoose from 'mongoose';
import { Order } from '../infrastructure/models/order.model';
import { ReturnRequest } from '../infrastructure/models/return-request.model';
import { codBankInfo } from './refund-request.service';

type BankInfo = { bank_name: string; account_holder: string; account_number: string };
const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

async function isCodOrder(orderId: unknown) {
    if (!mongoose.isValidObjectId(orderId)) return false;
    const order: any = await Order.findById(orderId).select('payment_method').lean();
    return String(order?.payment_method || '').toUpperCase() === 'COD';
}

/** Đơn COD chọn hoàn tiền: khách phải cho số tài khoản để admin chuyển khoản hoàn. */
export async function bankInfoForNewReturn(orderId: unknown, resolution: unknown, raw?: BankInfo) {
    if (resolution !== 'REFUND' || !(await isCodOrder(orderId))) return undefined;
    return codBankInfo(raw);
}

export async function saveReturnBankInfo(requestId: string, bank: BankInfo) {
    await ReturnRequest.updateOne({ _id: requestId }, { $set: { refund_bank_info: bank } });
}

export async function buyerUpdateReturnBankInfo(requestId: string, buyerId: string, raw?: BankInfo) {
    const request: any = await ReturnRequest.findById(requestId).select('buyer_id linked_refund_status').lean();
    if (!request || request.buyer_id !== buyerId) throw fail('Không tìm thấy yêu cầu đổi/trả.', 404);
    if (request.linked_refund_status === 'REFUNDED') throw fail('Yêu cầu đã hoàn tiền xong, không đổi được tài khoản.', 409);
    const bank = codBankInfo(raw);
    await saveReturnBankInfo(requestId, bank);
    return bank;
}

export async function returnBankInfoOf(requestId: string): Promise<BankInfo | null> {
    const request: any = await ReturnRequest.findById(requestId).select('refund_bank_info').lean();
    return request?.refund_bank_info ?? null;
}
