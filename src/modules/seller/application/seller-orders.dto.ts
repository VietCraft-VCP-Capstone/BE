/**
 * Shape đơn hàng trả cho NGƯỜI BÁN.
 *
 * Khác hẳn DTO của người mua (order/infrastructure/dto/order.dto.ts): người mua chỉ
 * cần biết đơn tới đâu rồi, người bán cần thêm giá vốn, tiền thực nhận, file thiết kế
 * và toàn bộ nhật ký trạng thái để xử lý đơn.
 *
 * Trạng thái ở đây giữ NGUYÊN tên trong DB ('ORDERED' | 'PROCESSING' | ...) chứ không
 * gộp lại thành 5 nhãn như phía người mua: seller phải phân biệt được đơn mới đặt chưa
 * trả tiền với đơn đang chờ thiết kế, hai việc cần làm hoàn toàn khác nhau.
 */

export type SellerOrderStatus =
    | 'ORDERED'
    | 'PENDING_DESIGN'
    | 'PROCESSING'
    | 'SHIPPING'
    | 'DELIVERED'
    | 'CANCELLED';

export const SELLER_ORDER_STATUSES: SellerOrderStatus[] = [
    'ORDERED',
    'PENDING_DESIGN',
    'PROCESSING',
    'SHIPPING',
    'DELIVERED',
    'CANCELLED'
];

export interface SellerOrderItemDTO {
    productId: string;
    variantId: string;
    title: string;
    sku?: string;
    color?: string;
    size?: string;
    quantity: number;
    /** Giá bán một sản phẩm. */
    price: number;
    /** Giá vốn phôi — người bán cần để biết lãi thật trên từng dòng. */
    baseCost: number;
    image?: string;
    /** File in cho đơn POD; rỗng nghĩa là dòng này không phải hàng in theo yêu cầu. */
    designFileUrl?: string;
}

export interface SellerOrderDTO {
    /** Mã đơn — cũng là khoá gọi mọi endpoint đơn hàng. */
    id: string;
    orderCode: string;
    status: SellerOrderStatus;
    paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
    paymentMethod: 'VNPAY' | 'MOMO' | 'COD';
    createdAt: string;
    updatedAt: string;
    buyer: {
        id: string;
        name: string;
    };
    shippingAddress: {
        recipientName: string;
        phone: string;
        addressDetail: string;
    };
    shipping: {
        carrier?: string;
        trackingNumber?: string;
        fee: number;
    };
    items: SellerOrderItemDTO[];
    /** Tổng SỐ LƯỢNG sản phẩm, không phải số dòng hàng. */
    itemCount: number;
    financials: {
        subtotal: number;
        shippingFee: number;
        discount: number;
        platformFee: number;
        /** Tiền người bán thực nhận sau khi trừ phí sàn. */
        payout: number;
        /** Tổng giá vốn phôi của cả đơn. */
        baseCost: number;
    };
    statusHistory: {
        status: SellerOrderStatus;
        changedAt: string;
        note?: string;
    }[];
}

export interface SellerOrderCountsDTO {
    all: number;
    ORDERED: number;
    PENDING_DESIGN: number;
    PROCESSING: number;
    SHIPPING: number;
    DELIVERED: number;
    CANCELLED: number;
}

export interface SellerOrderListDTO {
    items: SellerOrderDTO[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    /** Số đơn theo từng trạng thái, tính trên TOÀN BỘ kết quả tìm kiếm hiện tại
     *  (không bị bộ lọc trạng thái cắt) — để tab nào cũng hiện đúng con số. */
    counts: SellerOrderCountsDTO;
    revenue: {
        /** Tiền đã chốt: đơn đã giao thành công. */
        settled: number;
        /** Tiền đang treo: đơn chưa giao xong và chưa huỷ. */
        pending: number;
    };
}

const num = (v: any): number => (v === null || v === undefined ? 0 : Number(v.toString()) || 0);

/** `custom_notes` là chuỗi JSON do createOrder nhét vào (sku, blank_id, design_options).
 *  Đơn cũ có thể lưu ghi chú dạng chữ thường — parse hỏng thì bỏ qua, không làm vỡ đơn. */
function readSku(customNotes?: string): string | undefined {
    if (!customNotes) return undefined;
    try {
        const parsed = JSON.parse(customNotes);
        return typeof parsed?.sku === 'string' ? parsed.sku : undefined;
    } catch {
        return undefined;
    }
}

const iso = (v: any): string => (v instanceof Date ? v.toISOString() : new Date(v || Date.now()).toISOString());

export function mapDbOrderToSellerDTO(dbOrder: any): SellerOrderDTO {
    const fb = dbOrder.financial_breakdown || {};
    const rawItems: any[] = Array.isArray(dbOrder.items) ? dbOrder.items : [];

    const items: SellerOrderItemDTO[] = rawItems.map(it => ({
        productId: it.product_id?.toString() || '',
        variantId: it.variant_id?.toString() || '',
        title: it.title || 'Sản phẩm',
        sku: readSku(it.custom_notes),
        color: it.color,
        size: it.size,
        quantity: Number(it.quantity) || 0,
        price: num(it.retail_price),
        baseCost: num(it.base_cost),
        image: it.image,
        designFileUrl: it.design_file_url
    }));

    // buyer_id được populate ở service; chưa populate thì chỉ còn ObjectId — ObjectId
    // không có full_name/_id nên hai phép đọc dưới đây tự rơi về nhánh mặc định.
    const buyer: any = dbOrder.buyer_id;
    const buyerName: string | undefined = buyer?.full_name || buyer?.email;

    return {
        id: dbOrder.order_code,
        orderCode: dbOrder.order_code,
        status: dbOrder.order_status,
        paymentStatus: dbOrder.payment_status,
        paymentMethod: dbOrder.payment_method,
        createdAt: iso(dbOrder.created_at),
        updatedAt: iso(dbOrder.updated_at || dbOrder.created_at),
        buyer: {
            id: (buyer?._id || buyer)?.toString() || '',
            name: buyerName || dbOrder.shipping_address?.recipient_name || 'Khách hàng'
        },
        shippingAddress: {
            recipientName: dbOrder.shipping_address?.recipient_name || '',
            phone: dbOrder.shipping_address?.phone || '',
            addressDetail: dbOrder.shipping_address?.address_detail || ''
        },
        shipping: {
            carrier: dbOrder.shipping_details?.carrier || undefined,
            trackingNumber: dbOrder.shipping_details?.tracking_number || undefined,
            fee: num(dbOrder.shipping_details?.shipping_fee)
        },
        items,
        itemCount: items.reduce((sum, it) => sum + it.quantity, 0),
        financials: {
            subtotal: num(fb.subtotal),
            shippingFee: num(fb.shipping_fee),
            discount: num(fb.coupon_discount),
            platformFee: num(fb.platform_fee),
            payout: num(fb.seller_payout_amount),
            baseCost: items.reduce((sum, it) => sum + it.baseCost * it.quantity, 0)
        },
        statusHistory: (dbOrder.status_history || []).map((h: any) => ({
            status: h.status,
            changedAt: iso(h.changed_at),
            note: h.note
        }))
    };
}
