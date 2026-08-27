/**
 * Đơn hàng nhìn từ phía NGƯỜI BÁN.
 *
 * Trước module này, BE chỉ có `GET /orders` lọc theo `buyer_id`, nghĩa là tài khoản
 * seller gọi vào chỉ thấy đơn họ ĐI MUA chứ không thấy đơn bán được. Ở đây mọi truy
 * vấn đều khoá theo `shop_id` của shop mà chính người đang đăng nhập sở hữu
 * (`Shop.owner_id` là unique -> mỗi seller đúng một shop), nên không có đường nào để
 * seller đọc hay sửa đơn của gian hàng khác.
 */

import mongoose from 'mongoose';
import { Order } from '../../order/infrastructure/models/order.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import {
    SellerOrderDTO,
    SellerOrderListDTO,
    SellerOrderCountsDTO,
    SellerOrderStatus,
    SELLER_ORDER_STATUSES,
    mapDbOrderToSellerDTO
} from './seller-orders.dto';

const DEFAULT_PAGE_SIZE = 20;
/** Trần cứng: chặn client xin cả chục nghìn đơn trong một lượt. */
const MAX_PAGE_SIZE = 100;

/**
 * Trạng thái người bán được phép chuyển sang, theo trạng thái hiện tại.
 *
 * Cố ý KHÔNG cho seller tự đặt PAID hay quay ngược trạng thái: tiền chỉ được đánh dấu
 * đã trả bởi callback của cổng thanh toán, còn lùi trạng thái sẽ làm nhật ký đơn hàng
 * mất ý nghĩa đối soát.
 */
const ALLOWED_TRANSITIONS: Record<SellerOrderStatus, SellerOrderStatus[]> = {
    ORDERED: ['PROCESSING', 'CANCELLED'],
    PENDING_DESIGN: ['PROCESSING', 'CANCELLED'],
    PROCESSING: ['SHIPPING', 'CANCELLED'],
    SHIPPING: ['DELIVERED'],
    DELIVERED: [],
    CANCELLED: []
};

/** Đơn coi như đã đóng — tiền không còn treo, không còn việc gì để làm. */
const CLOSED_STATUSES: SellerOrderStatus[] = ['DELIVERED', 'CANCELLED'];

/**
 * Nhóm lọc 'TODO': mọi đơn còn nằm trong tay người bán.
 *
 * Không phải một trạng thái trong DB mà là câu hỏi "hôm nay tôi phải làm gì" — ba
 * trạng thái này khác nhau ở bước tiếp theo, nhưng giống nhau ở chỗ đơn sẽ đứng im
 * cho tới khi người bán động vào.
 */
const TODO_STATUSES: SellerOrderStatus[] = ['ORDERED', 'PENDING_DESIGN', 'PROCESSING'];

export interface SellerOrderListQuery {
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    /** 'newest' (mặc định) | 'oldest' | 'highest' | 'lowest' theo giá trị đơn. */
    sort?: string;
}

export interface SellerOrderStatusUpdate {
    status: string;
    trackingNumber?: string;
    carrier?: string;
    note?: string;
}

/** Người dùng nhập gì cũng chỉ là chữ cần tìm, không phải cú pháp regex. */
function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isValidStatus(value: any): value is SellerOrderStatus {
    return SELLER_ORDER_STATUSES.includes(value);
}

const SORTS: Record<string, Record<string, 1 | -1>> = {
    newest: { created_at: -1 },
    oldest: { created_at: 1 },
    highest: { 'financial_breakdown.subtotal': -1 },
    lowest: { 'financial_breakdown.subtotal': 1 }
};

export class SellerOrdersService {
    /**
     * Shop của người đang đăng nhập. Trả null khi seller chưa từng thiết lập gian hàng —
     * đó là trạng thái hợp lệ (danh sách đơn rỗng), không phải lỗi.
     */
    private static async findShopId(ownerId: string): Promise<mongoose.Types.ObjectId | null> {
        if (!mongoose.Types.ObjectId.isValid(ownerId)) {
            throw new Error('Phiên đăng nhập không hợp lệ');
        }
        const shop = await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(ownerId) }).select('_id').lean();
        return shop ? (shop._id as mongoose.Types.ObjectId) : null;
    }

    static async listOrders(ownerId: string, query: SellerOrderListQuery): Promise<SellerOrderListDTO> {
        const page = Math.max(1, Number(query.page) || 1);
        const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.pageSize) || DEFAULT_PAGE_SIZE));
        const emptyCounts: SellerOrderCountsDTO = {
            all: 0, ORDERED: 0, PENDING_DESIGN: 0, PROCESSING: 0, SHIPPING: 0, DELIVERED: 0, CANCELLED: 0
        };

        const shopId = await this.findShopId(ownerId);
        if (!shopId) {
            return {
                items: [], total: 0, page, pageSize, totalPages: 0,
                counts: emptyCounts,
                revenue: { settled: 0, pending: 0 }
            };
        }

        // Điều kiện nền: shop + từ khoá. Bộ lọc trạng thái KHÔNG nằm ở đây vì phần đếm
        // theo trạng thái phải tính trên toàn bộ kết quả tìm kiếm, không thì mọi tab
        // đều hiện đúng con số của tab đang mở.
        const baseMatch: Record<string, any> = { shop_id: shopId };
        const search = String(query.search || '').trim();
        if (search) {
            const rx = new RegExp(escapeRegex(search), 'i');
            baseMatch.$or = [
                { order_code: rx },
                { 'shipping_address.recipient_name': rx },
                { 'shipping_address.phone': rx },
                { 'shipping_details.tracking_number': rx },
                { 'items.title': rx }
            ];
        }

        const listMatch = { ...baseMatch };
        if (query.status === 'TODO') listMatch.order_status = { $in: TODO_STATUSES };
        else if (isValidStatus(query.status)) listMatch.order_status = query.status;

        const sort = SORTS[String(query.sort || 'newest')] || SORTS.newest;

        const [total, docs, grouped] = await Promise.all([
            Order.countDocuments(listMatch),
            Order.find(listMatch)
                .populate('buyer_id', 'full_name email')
                .sort(sort)
                .skip((page - 1) * pageSize)
                .limit(pageSize)
                .lean(),
            Order.aggregate([
                { $match: baseMatch },
                {
                    $group: {
                        _id: '$order_status',
                        count: { $sum: 1 },
                        payout: { $sum: '$financial_breakdown.seller_payout_amount' }
                    }
                }
            ])
        ]);

        const counts = { ...emptyCounts };
        let settled = 0;
        let pending = 0;
        for (const row of grouped) {
            const status = row._id as SellerOrderStatus;
            const payout = Number(row.payout?.toString() || 0) || 0;
            if (isValidStatus(status)) counts[status] = row.count;
            counts.all += row.count;
            if (status === 'DELIVERED') settled += payout;
            else if (status !== 'CANCELLED') pending += payout;
        }

        return {
            items: docs.map(mapDbOrderToSellerDTO),
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
            counts,
            revenue: { settled, pending }
        };
    }

    /** Nhận order_code hoặc _id, nhưng luôn giới hạn trong shop của chính seller. */
    static async getOrder(ownerId: string, id: string): Promise<SellerOrderDTO> {
        const shopId = await this.findShopId(ownerId);
        if (!shopId) throw new Error('Không tìm thấy đơn hàng');

        const order = await Order.findOne({
            shop_id: shopId,
            $or: [
                { order_code: id },
                { _id: mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null }
            ]
        })
            .populate('buyer_id', 'full_name email')
            .lean();

        if (!order) throw new Error('Không tìm thấy đơn hàng');
        return mapDbOrderToSellerDTO(order);
    }

    static async updateStatus(
        ownerId: string,
        id: string,
        payload: SellerOrderStatusUpdate
    ): Promise<SellerOrderDTO> {
        const shopId = await this.findShopId(ownerId);
        if (!shopId) throw new Error('Không tìm thấy đơn hàng');

        const next = String(payload.status || '').toUpperCase();
        if (!isValidStatus(next)) throw new Error(`Trạng thái "${payload.status}" không hợp lệ`);

        const order = await Order.findOne({
            shop_id: shopId,
            $or: [
                { order_code: id },
                { _id: mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null }
            ]
        });
        if (!order) throw new Error('Không tìm thấy đơn hàng');

        const current = order.order_status as SellerOrderStatus;
        if (!ALLOWED_TRANSITIONS[current]?.includes(next)) {
            throw new Error(
                CLOSED_STATUSES.includes(current)
                    ? 'Đơn hàng đã kết thúc, không thể đổi trạng thái.'
                    : `Không thể chuyển đơn từ "${current}" sang "${next}".`
            );
        }

        // Nhận đơn vào sản xuất khi tiền chưa về là seller tự gánh rủi ro: hàng POD in
        // xong không bán lại được cho ai khác. COD là ngoại lệ duy nhất — theo thiết kế
        // thì đơn COD chỉ thu tiền lúc giao, nên không bao giờ PAID trước.
        if (next === 'PROCESSING' && order.payment_status !== 'PAID' && order.payment_method !== 'COD') {
            throw new Error('Đơn chưa thanh toán. Chỉ nhận sản xuất sau khi tiền đã về.');
        }

        const tracking = String(payload.trackingNumber || '').trim();
        if (next === 'SHIPPING') {
            if (!tracking) throw new Error('Cần mã vận đơn khi bàn giao cho đơn vị vận chuyển.');
            order.shipping_details.tracking_number = tracking;
            const carrier = String(payload.carrier || '').toLowerCase();
            if (carrier === 'ghn' || carrier === 'ghtk') order.shipping_details.carrier = carrier;
        } else if (tracking) {
            order.shipping_details.tracking_number = tracking;
        }

        // Đơn COD chỉ thu được tiền lúc giao tận tay, nên đây là chỗ duy nhất
        // payment_status của đơn COD được chuyển sang PAID.
        if (next === 'DELIVERED' && order.payment_method === 'COD' && order.payment_status === 'PENDING') {
            order.payment_status = 'PAID';
        }

        order.order_status = next;
        order.status_history.push({
            status: next,
            changed_at: new Date(),
            note: String(payload.note || '').trim() || undefined
        });
        await order.save();

        const saved = await Order.findById(order._id).populate('buyer_id', 'full_name email').lean();
        return mapDbOrderToSellerDTO(saved || order.toObject());
    }
}

export default SellerOrdersService;
