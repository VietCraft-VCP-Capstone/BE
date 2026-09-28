import mongoose from 'mongoose';
import { Order } from '../infrastructure/models/order.model';
import { RefundRequest, IRefundRequest, RefundRequestStatus } from '../infrastructure/models/refund-request.model';
import { RefundStateMachine, RefundActor } from './refund-state-machine';
import { Product } from '../../product/infrastructure/models/product.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { User } from '../../user/infrastructure/models/user.model';
import { notificationService } from '../../notification';
import { logger } from '../../../shared/utils/logger';
import { config } from '../../../app/config';

const DAY = 24 * 60 * 60 * 1000;
const PHYSICAL_REASONS = new Set(['DAMAGED', 'PRINT_DEFECT', 'MISSING_ITEM']);
const VALID_REASONS = new Set(['DAMAGED', 'WRONG_DESCRIPTION', 'PRINT_DEFECT', 'MISSING_ITEM', 'OTHER']);
import { buildTestDeliveredOrder } from './test-order.factory';
import { byCodeOrId } from '../utils';
const ALLOWED_TRANSITIONS: Record<RefundRequestStatus, RefundRequestStatus[]> = {
    PENDING_SELLER: ['SELLER_APPROVED', 'SELLER_REJECTED', 'PENDING_PRINTER', 'TIMEOUT_ESCALATED'],
    SELLER_APPROVED: ['REFUNDED'], SELLER_REJECTED: ['DISPUTED'],
    PENDING_PRINTER: ['PRINTER_APPROVED', 'PRINTER_REJECTED', 'TIMEOUT_ESCALATED'],
    PRINTER_APPROVED: ['REFUNDED'], PRINTER_REJECTED: ['DISPUTED'],
    DISPUTED: ['ADMIN_APPROVED', 'ADMIN_REJECTED'], ADMIN_APPROVED: ['REFUNDED'],
    ADMIN_REJECTED: [], REFUNDED: [], TIMEOUT_ESCALATED: ['DISPUTED'],
};

export interface CreateRefundRequestInput {
    reason_category: string;
    description: string;
    evidence?: string[];
    refund_type: 'FULL' | 'PARTIAL';
    refund_amount?: number;
}

export class RefundRequestService {
    private static notify(userId: string, title: string, content: string, link: string, metadata: Record<string, unknown> = {}) {
        return notificationService.createNotification({ user_id: userId, type: 'ORDER_UPDATE', title, content, link, metadata });
    }

    static async create(orderId: string, buyerId: string, input: CreateRefundRequestInput) {
        if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(buyerId)) throw new Error('ID không hợp lệ');
        if (!VALID_REASONS.has(input.reason_category)) throw new Error('reason_category không hợp lệ');
        if (!input.description?.trim() || input.description.trim().length < 5) throw new Error('Mô tả phải có ít nhất 5 ký tự');
        const evidence = input.evidence || [];
        if (!Array.isArray(evidence) || evidence.some(url => typeof url !== 'string' || !/^https?:\/\//i.test(url))) throw new Error('Evidence phải là danh sách URL HTTP/HTTPS hợp lệ');
        if (PHYSICAL_REASONS.has(input.reason_category) && evidence.length === 0) throw new Error('Lý do này bắt buộc đính kèm bằng chứng');
        if (input.refund_type !== 'FULL' && input.refund_type !== 'PARTIAL') throw new Error('refund_type không hợp lệ');

        const order = await Order.findOne({ _id: orderId, buyer_id: buyerId });
        if (!order) throw new Error('Không tìm thấy đơn hàng');
        if (order.order_status !== 'DELIVERED') throw new Error('Chỉ đơn đã giao mới được yêu cầu hoàn tiền');
        const now = new Date();
        const deliveredAt = [...order.status_history].reverse().find(entry => entry.status === 'DELIVERED')?.changed_at;
        if (!deliveredAt) throw new Error('Không xác định được thời điểm giao hàng của đơn');
        if (now.getTime() > deliveredAt.getTime() + 7 * DAY) throw new Error('Đã quá thời hạn yêu cầu hoàn tiền 7 ngày');
        if (order.refund_status !== 'NONE') throw new Error('Đơn hàng đã có yêu cầu hoàn tiền hoặc đã được xử lý');

        const products = await Product.find({ _id: { $in: order.items.map(item => item.product_id) } }).select('product_type shop_id').lean();
        if (!products.length) throw new Error('Không xác định được sản phẩm trong đơn hàng');
        const shop = await Shop.findById(order.shop_id).lean();
        if (!shop) throw new Error('Không tìm thấy gian hàng');
        const maxRefund = Number(order.financial_breakdown.subtotal.toString()) + Number(order.financial_breakdown.shipping_fee.toString()) - Number(order.financial_breakdown.coupon_discount.toString());
        const amount = input.refund_type === 'FULL' ? maxRefund : Number(input.refund_amount);
        if (!Number.isFinite(amount) || amount <= 0 || amount > maxRefund) throw new Error('Số tiền hoàn không hợp lệ');
        if (input.refund_type === 'PARTIAL' && !input.refund_amount) throw new Error('PARTIAL cần refund_amount');

        const doc = await RefundRequest.create({
            order_id: order._id, buyer_id: order.buyer_id, seller_id: shop.owner_id,
            product_type: products.some(p => p.product_type === 'POD_TEMPLATE') ? 'POD' : 'NORMAL',
            reason_category: input.reason_category, description: input.description.trim(), evidence,
            refund_type: input.refund_type, refund_amount: amount, status: 'PENDING_SELLER',
            sla_deadlines: { seller_deadline: new Date(now.getTime() + 48 * 60 * 60 * 1000) },
        });
        const changed = await Order.updateOne({ _id: order._id, refund_status: 'NONE' }, { $set: { refund_status: 'REQUESTED' } });
        if (!changed.modifiedCount) {
            await RefundRequest.deleteOne({ _id: doc._id });
            throw new Error('Đơn hàng đã có yêu cầu hoàn tiền');
        }
        void this.notify(shop.owner_id.toString(), 'Yêu cầu hoàn tiền mới', `Có yêu cầu hoàn tiền cho đơn ${order.order_code}.`, '/seller/refund-requests', { refundRequestId: doc._id.toString() }).catch(err => logger.error(`[REFUND] Notification failed: ${err.message}`));
        return doc;
    }

    static async createTestFlow(orderId: string, buyerId: string) {
        if (process.env.NODE_ENV === 'production') throw new Error('Chức năng test Refund/Dispute chỉ dùng trong development');
        if (!mongoose.Types.ObjectId.isValid(buyerId)) throw new Error('ID buyer không hợp lệ');
        const source = await Order.findOne({ ...byCodeOrId(orderId), buyer_id: buyerId, order_status: 'ORDERED' }).lean();
        if (!source) throw new Error('Chỉ tạo luồng test từ đơn đang chờ của chính bạn');
        const shop = await Shop.findById(source.shop_id).lean();
        if (!shop?.owner_id) throw new Error('Không xác định được chủ shop');
        const sourceProducts = await Product.find({ _id: { $in: source.items.map(item => item.product_id) } }).select('product_type').lean();
        const productType = sourceProducts.some(product => product.product_type === 'POD_TEMPLATE') ? 'POD' : 'NORMAL';

        const testOrder = await Order.create(buildTestDeliveredOrder({
            buyer_id: source.buyer_id, shop_id: source.shop_id, payment_method: source.payment_method,
            shipping_address: source.shipping_address, shipping_details: source.shipping_details,
            items: source.items, financial_breakdown: source.financial_breakdown,
            order_hour_of_week: source.order_hour_of_week,
        }));
        try {
            const amount = Number(testOrder.financial_breakdown.subtotal.toString()) + Number(testOrder.financial_breakdown.shipping_fee.toString()) - Number(testOrder.financial_breakdown.coupon_discount.toString());
            const request = await RefundRequest.create({
                order_id: testOrder._id, buyer_id: testOrder.buyer_id, seller_id: shop.owner_id,
                product_type: productType, reason_category: 'OTHER',
                description: 'Luồng test Refund/Dispute; không phát sinh giao dịch hoàn tiền.',
                evidence: [], refund_type: 'FULL', refund_amount: amount,
                status: 'PENDING_SELLER', sla_deadlines: { seller_deadline: new Date(Date.now() + 48 * 60 * 60 * 1000) },
            });
            await Order.updateOne({ _id: testOrder._id }, { $set: { refund_status: 'REQUESTED' } });
            return { order_id: testOrder.order_code, refund_request_id: request._id.toString(), order_status: testOrder.order_status, payment_status: testOrder.payment_status, refund_status: 'REQUESTED' };
        } catch (error) {
            await Order.deleteOne({ _id: testOrder._id });
            throw error;
        }
    }

    static async getForBuyer(id: string, buyerId: string) {
        if (!mongoose.Types.ObjectId.isValid(id)) throw new Error('ID không hợp lệ');
        const doc = await RefundRequest.findOne({ _id: id, buyer_id: buyerId }).populate('order_id');
        if (!doc) throw new Error('Không tìm thấy yêu cầu hoàn tiền');
        return doc;
    }

    static async getForOrder(orderId: string, buyerId: string) {
        const order = await Order.findOne({ ...byCodeOrId(orderId), buyer_id: buyerId }).select('_id').lean();
        if (!order) throw new Error('Không tìm thấy đơn hàng');
        return RefundRequest.findOne({ order_id: order._id, buyer_id: buyerId }).populate('order_id').sort({ created_at: -1 });
    }

    static async printerList() {
        return RefundRequest.find({ status: 'PENDING_PRINTER' }).populate('order_id').populate('buyer_id', 'full_name email').sort({ created_at: 1 }).lean();
    }

    static async sellerList(sellerId: string, status?: string) {
        const query: Record<string, unknown> = { seller_id: sellerId };
        if (status) query.status = status;
        return RefundRequest.find(query)
            .populate({ path: 'order_id', select: 'order_code order_status payment_status items financial_breakdown' })
            .populate({ path: 'buyer_id', select: 'full_name email avatar' })
            .sort({ created_at: -1 }).lean();
    }

    private static async assertSellerOwnership(requestId: string, sellerId: string) {
        if (!mongoose.Types.ObjectId.isValid(requestId)) throw new Error('ID không hợp lệ');
        const doc = await RefundRequest.findOne({ _id: requestId, seller_id: sellerId });
        if (!doc) throw new Error('Không tìm thấy yêu cầu hoàn tiền');
        return doc;
    }

    static async triage(requestId: string, sellerId: string, result: string, checklist?: { evidence_reviewed: boolean; order_verified: boolean; artwork_checked: boolean; seller_terms_checked: boolean; note: string }) {
        const doc = await this.assertSellerOwnership(requestId, sellerId);
        if (doc.product_type !== 'POD') throw new Error('Triage chỉ áp dụng cho POD');
        if (doc.status !== 'PENDING_SELLER' || doc.triage_result) throw new Error('Request không còn ở trạng thái chờ triage');
        if (!['SELLER_RESPONSIBILITY', 'PRINTER_RESPONSIBILITY'].includes(result)) throw new Error('triage_result không hợp lệ');
        const checks = ['evidence_reviewed', 'order_verified', 'artwork_checked', 'seller_terms_checked'] as const;
        if (!checklist || checks.some(key => checklist[key] !== true) || !checklist.note?.trim()) throw new Error('Hoàn thành toàn bộ checklist POD và ghi chú trước khi triage');
        const next = result === 'PRINTER_RESPONSIBILITY' ? 'PENDING_PRINTER' : 'PENDING_SELLER';
        RefundStateMachine.assertTransition(doc.status, 'seller-triage', next);
        const set: Record<string, unknown> = { triage_result: result, triage_checklist: { ...checklist, note: checklist.note.trim() } };
        if (next === 'PENDING_PRINTER') {
            const order = await Order.findById(doc.order_id).select('order_code').lean();
            if (!config.printerRefundApiKey) throw new Error('Printing mock chưa được cấu hình để nhận yêu cầu');
            const response = await fetch(`${config.printerApiUrl}/api/orders/refund-requests`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-vietcraft-refund-key': config.printerRefundApiKey },
                body: JSON.stringify({
                    refund_request_id: doc._id.toString(), order_code: order?.order_code,
                    reason_category: doc.reason_category, description: doc.description,
                    evidence: doc.evidence, refund_type: doc.refund_type, refund_amount: doc.refund_amount,
                    triage_result: result, seller_response: doc.seller_response,
                    sla_deadline: new Date(Date.now() + 48 * 60 * 60 * 1000),
                }),
            });
            if (!response.ok) throw new Error(`Printing mock từ chối request (${response.status})`);
            set.status = next;
            set['sla_deadlines.printer_deadline'] = new Date(Date.now() + 48 * 60 * 60 * 1000);
            set.printer_id = 'PRINTING_SHOP_MOCK';
        }
        const updated = await RefundRequest.findOneAndUpdate({ _id: doc._id, status: 'PENDING_SELLER', triage_result: null }, { $set: { ...set, ...(next === 'PENDING_PRINTER' ? { status: next } : {}) } }, { new: true });
        if (!updated) throw new Error('Request đã được cập nhật đồng thời; hãy tải lại');
        return updated;
    }

    static async sellerDecision(requestId: string, sellerId: string, decision: 'APPROVE' | 'REJECT', note?: string) {
        if (!['APPROVE', 'REJECT'].includes(decision)) throw new Error('decision không hợp lệ');
        const doc = await this.assertSellerOwnership(requestId, sellerId);
        if (doc.status !== 'PENDING_SELLER' || (doc.product_type === 'POD' && doc.triage_result !== 'SELLER_RESPONSIBILITY')) throw new Error('Request chưa đủ điều kiện để seller quyết định');
        const status: RefundRequestStatus = decision === 'APPROVE' ? 'SELLER_APPROVED' : 'SELLER_REJECTED';
        RefundStateMachine.assertTransition(doc.status, 'seller-decision', status);
        const updated = await RefundRequest.findOneAndUpdate({ _id: doc._id, status: 'PENDING_SELLER' }, { $set: { status, responsible_party: 'SELLER', seller_response: { decision, note, responded_at: new Date() } } }, { new: true });
        if (!updated) throw new Error('Request đã được cập nhật đồng thời; hãy tải lại');
        if (decision === 'REJECT') await Order.updateOne({ _id: doc.order_id, refund_status: { $in: ['REQUESTED', 'UNDER_REVIEW'] } }, { $set: { refund_status: 'REFUND_REJECTED' } });
        else await Order.updateOne({ _id: doc.order_id }, { $set: { refund_status: 'UNDER_REVIEW' } });
        if (decision === 'APPROVE') await this.executeRefund(updated);
        else void this.notify(doc.buyer_id.toString(), 'Yêu cầu hoàn tiền bị từ chối', 'Seller đã từ chối yêu cầu; bạn có thể mở dispute.', `/refund-requests/${doc._id}`, { refundRequestId: doc._id.toString() }).catch(err => logger.error(`[REFUND] Notification failed: ${err.message}`));
        return updated;
    }

    static async printerRespond(requestId: string, decision: 'APPROVE' | 'REJECT', note?: string) {
        if (!['APPROVE', 'REJECT'].includes(decision)) throw new Error('decision không hợp lệ');
        const doc = await RefundRequest.findOne({ _id: requestId, status: 'PENDING_PRINTER' });
        if (!doc) throw new Error('Không tìm thấy request đang chờ Printer');
        const next: RefundRequestStatus = decision === 'APPROVE' ? 'PRINTER_APPROVED' : 'PRINTER_REJECTED';
        RefundStateMachine.assertTransition(doc.status, 'printer-response', next);
        const updated = await RefundRequest.findOneAndUpdate({ _id: doc._id, status: 'PENDING_PRINTER', printer_response: { $exists: false } }, { $set: { status: next, responsible_party: 'PRINTER', printer_response: { decision, note, responded_at: new Date() } } }, { new: true });
        if (!updated) throw new Error('Printer response đã được xử lý');
        await Order.updateOne({ _id: doc.order_id }, { $set: { refund_status: decision === 'APPROVE' ? 'UNDER_REVIEW' : 'REFUND_REJECTED' } });
        if (decision === 'APPROVE') await this.executeRefund(updated);
        else void this.notify(doc.buyer_id.toString(), 'Printer từ chối yêu cầu hoàn tiền', 'Bạn có thể mở dispute với quản trị viên.', `/refund-requests/${doc._id}`, { refundRequestId: doc._id.toString() }).catch(err => logger.error(`[REFUND] Notification failed: ${err.message}`));
        return updated;
    }

    static async dispute(requestId: string, buyerId: string, reason: string) {
        if (typeof reason !== 'string' || reason.trim().length < 5) throw new Error('Lý do tranh chấp cần ít nhất 5 ký tự');
        const doc = await RefundRequest.findOne({ _id: requestId, buyer_id: buyerId });
        if (!doc) throw new Error('Không tìm thấy yêu cầu hoàn tiền');
        RefundStateMachine.assertTransition(doc.status, 'buyer-dispute', 'DISPUTED');
        const prior = doc.status;
        const updated = await RefundRequest.findOneAndUpdate({ _id: doc._id, status: prior, dispute: { $exists: false } }, { $set: { status: 'DISPUTED', dispute: { opened_by: new mongoose.Types.ObjectId(buyerId), reason: reason.trim(), opened_at: new Date() } } }, { new: true });
        if (!updated) throw new Error('Dispute đã mở hoặc request được cập nhật đồng thời');
        await Order.updateOne({ _id: doc.order_id }, { $set: { refund_status: 'DISPUTED' } });
        const admins = await User.find({ role: 'ADMIN' }).select('_id').lean();
        await Promise.allSettled(admins.map(admin => this.notify(admin._id.toString(), 'Dispute cần xử lý', `Có dispute cho refund ${doc._id}.`, '/admin/refund-requests?status=DISPUTED', { refundRequestId: doc._id.toString() })));
        return updated;
    }

    static async sellerDispute(requestId: string, sellerId: string, reason: string) {
        const doc = await this.assertSellerOwnership(requestId, sellerId);
        if (!reason?.trim()) throw new Error('Cần ghi lý do tranh chấp');
        if (doc.product_type !== 'POD' || doc.triage_result !== 'PRINTER_RESPONSIBILITY') throw new Error('Chỉ POD đã chuyển Printer mới được seller tranh chấp');
        RefundStateMachine.assertTransition(doc.status, 'seller-dispute', 'DISPUTED');
        const updated = await RefundRequest.findOneAndUpdate(
            { _id: doc._id, status: doc.status, dispute: { $exists: false } },
            { $set: { status: 'DISPUTED', dispute: { opened_by: new mongoose.Types.ObjectId(sellerId), reason: reason.trim(), opened_at: new Date() } } },
            { new: true },
        );
        if (!updated) throw new Error('Dispute đã mở hoặc request được cập nhật đồng thời');
        await Order.updateOne({ _id: doc.order_id }, { $set: { refund_status: 'DISPUTED' } });
        const admins = await User.find({ role: 'ADMIN' }).select('_id').lean();
        await Promise.allSettled(admins.map(admin => this.notify(admin._id.toString(), 'POD cần Admin phân xử', `Seller yêu cầu Admin phân xử refund ${doc._id}.`, '/admin/refund-requests?status=DISPUTED', { refundRequestId: doc._id.toString() })));
        return updated;
    }

    static async adminList(status = 'DISPUTED') {
        return RefundRequest.find({ status }).populate('order_id buyer_id seller_id dispute.opened_by admin_decision.decided_by').sort({ created_at: -1 }).lean();
    }

    static async adminResolve(requestId: string, adminId: string, decision: 'APPROVE' | 'REJECT', costBearer: 'SELLER' | 'PRINTER' | 'PLATFORM', amount?: number, note = '') {
        if (!mongoose.Types.ObjectId.isValid(requestId) || !mongoose.Types.ObjectId.isValid(adminId)) throw new Error('ID không hợp lệ');
        if (!['APPROVE', 'REJECT'].includes(decision)) throw new Error('decision không hợp lệ');
        const doc = await RefundRequest.findOne({ _id: requestId, status: 'DISPUTED' });
        if (!doc) throw new Error('Không tìm thấy dispute đang chờ xử lý');
        if (!['SELLER', 'PRINTER', 'PLATFORM'].includes(costBearer)) throw new Error('cost_bearer không hợp lệ');
        const status: RefundRequestStatus = decision === 'APPROVE' ? 'ADMIN_APPROVED' : 'ADMIN_REJECTED';
        RefundStateMachine.assertTransition(doc.status, 'admin-resolve', status);
        const refundAmount = amount ?? doc.refund_amount;
        const order = await Order.findById(doc.order_id).select('financial_breakdown').lean();
        const maximum = order ? Number(order.financial_breakdown.subtotal.toString()) + Number(order.financial_breakdown.shipping_fee.toString()) - Number(order.financial_breakdown.coupon_discount.toString()) : 0;
        if (decision === 'APPROVE' && (!Number.isFinite(refundAmount) || !refundAmount || refundAmount <= 0 || refundAmount > maximum)) throw new Error('Số tiền hoàn không hợp lệ');
        if (decision === 'APPROVE' && doc.refund_type === 'PARTIAL' && amount === undefined) throw new Error('Admin cần chỉ định refund_amount cho quyết định partial');
        if (typeof note !== 'string' || note.trim().length < 3) throw new Error('Note cần ít nhất 3 ký tự');
        const updated = await RefundRequest.findOneAndUpdate({ _id: doc._id, status: 'DISPUTED' }, { $set: { status, responsible_party: costBearer, refund_amount: refundAmount, admin_decision: { decided_by: new mongoose.Types.ObjectId(adminId), decision, refund_type: decision === 'APPROVE' && Number(refundAmount) < maximum ? 'PARTIAL' : 'FULL', cost_bearer: costBearer, note, decided_at: new Date() } } }, { new: true });
        if (!updated) throw new Error('Dispute đã được xử lý đồng thời');
        if (decision === 'REJECT') await Order.updateOne({ _id: doc.order_id }, { $set: { refund_status: 'REFUND_REJECTED' } });
        else { await Order.updateOne({ _id: doc.order_id }, { $set: { refund_status: 'UNDER_REVIEW' } }); await this.executeRefund(updated); }
        void this.notify(doc.buyer_id.toString(), decision === 'APPROVE' ? 'Dispute được chấp thuận' : 'Dispute bị từ chối', `Quản trị viên đã ${decision === 'APPROVE' ? 'chấp thuận' : 'từ chối'} dispute.`, `/refund-requests/${doc._id}`, { refundRequestId: doc._id.toString() }).catch(err => logger.error(`[REFUND] Notification failed: ${err.message}`));
        return updated;
    }

    private static async executeRefund(doc: IRefundRequest) {
        // VNPayService.refundOrder mutates order_status to CANCELLED. MOMO/COD also lack a safe adapter.
        // Do not call a gateway or mark this request refunded until an order-status-safe adapter exists.
        void this.notify(doc.buyer_id.toString(), 'Yêu cầu đã được duyệt, chờ hoàn tiền', 'Quyết định đã được ghi nhận. Hệ thống hiện chưa hỗ trợ hoàn tiền tự động cho phương thức thanh toán này.', `/refund-requests/${doc._id}`, { refundRequestId: doc._id.toString() }).catch(err => logger.error(`[REFUND] Notification failed: ${err.message}`));
        return { executed: false, reason: 'GATEWAY_NOT_AVAILABLE' };
    }

    static async timeoutExpired(now = new Date()) {
        const expired = await RefundRequest.find({ $or: [
            { status: 'PENDING_SELLER', 'sla_deadlines.seller_deadline': { $lte: now } },
            { status: 'PENDING_PRINTER', 'sla_deadlines.printer_deadline': { $lte: now } },
        ] }).select('_id status buyer_id order_id seller_id product_type triage_result').lean();
        let escalated = 0;
        for (const request of expired) {
            const printerTimeout = request.status === 'PENDING_PRINTER';
            const nextStatus: RefundRequestStatus = printerTimeout ? 'DISPUTED' : 'TIMEOUT_ESCALATED';
            RefundStateMachine.assertTransition(request.status, 'timeout', nextStatus);
            const set: Record<string, unknown> = { status: nextStatus };
            if (printerTimeout) set.dispute = { reason: 'Printer không phản hồi trong SLA; hệ thống tự động chuyển Admin phân xử.', opened_at: now };
            const result = await RefundRequest.updateOne({ _id: request._id, status: request.status }, { $set: set });
            if (!result.modifiedCount) continue;
            escalated += 1;
            await Order.updateOne({ _id: request.order_id }, { $set: { refund_status: printerTimeout ? 'DISPUTED' : 'UNDER_REVIEW' } });
            if (printerTimeout) {
                void this.notify(request.buyer_id.toString(), 'Printer quá SLA', 'Yêu cầu được tự động chuyển cho Admin phân xử.', `/refund-requests/${request._id}`, { refundRequestId: request._id.toString() }).catch(err => logger.error(`[REFUND] Notification failed: ${err.message}`));
                const admins = await User.find({ role: 'ADMIN' }).select('_id').lean();
                await Promise.allSettled(admins.map(admin => this.notify(admin._id.toString(), 'Printer quá SLA — cần Admin phân xử', `Refund ${request._id} được tự động đưa vào hàng chờ Admin.`, '/admin/refund-requests?status=DISPUTED', { refundRequestId: request._id.toString() })));
            } else {
                void this.notify(request.buyer_id.toString(), 'Seller quá SLA', 'Người bán chưa phản hồi đúng hạn. Bạn có thể mở tranh chấp.', `/refund-requests/${request._id}`, { refundRequestId: request._id.toString() }).catch(err => logger.error(`[REFUND] Notification failed: ${err.message}`));
            }
        }
        return escalated;
    }
}
