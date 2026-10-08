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
    price: number;
    baseCost: number;
    image?: string;
    designFileUrl?: string;
}

export interface SellerOrderDTO {
    id: string;
    orderCode: string;
    status: SellerOrderStatus;
    approvalStatus?: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
    fulfillmentStatus?: string;
    supplierOrderId?: string;
    printerInfo?: {
        printerId?: string;
        printerName?: string;
        supplierOrderId?: string;
        printerStatus?: string;
        dispatchedAt?: string;
        rejectionReason?: string;
    };
    canApprove?: boolean;
    isPod: boolean;
    orderType: 'POD' | 'READY_TO_SHIP' | 'STANDARD';
    paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
    paymentMethod: 'VNPAY' | 'PAYOS' | 'COD';
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
    itemCount: number;
    financials: {
        subtotal: number;
        shippingFee: number;
        discount: number;
        platformFee: number;
        payout: number;
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
    PENDING_APPROVAL: number;
    POD_ORDERS: number;
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
    counts: SellerOrderCountsDTO;
    revenue: {
        settled: number;
        pending: number;
    };
}

const num = (v: any): number => (v === null || v === undefined ? 0 : Number(v.toString()) || 0);

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

    const buyer: any = dbOrder.buyer_id;
    const buyerName: string | undefined = buyer?.full_name || buyer?.email;

    const approvalStatus = dbOrder.seller_approval_status || (dbOrder.fulfillment_status === 'PENDING_APPROVAL' ? 'PENDING_APPROVAL' : 'APPROVED');
    const canApprove = approvalStatus === 'PENDING_APPROVAL' && ['ORDERED', 'PENDING_DESIGN'].includes(dbOrder.order_status);

    const isPod = Boolean(
        dbOrder.is_pod ||
        dbOrder.order_type === 'POD' ||
        rawItems.some(it => !!it.design_file_url) ||
        Boolean(dbOrder.supplier_order_id || dbOrder.printer_info?.supplier_order_id)
    );
    const orderType: 'POD' | 'READY_TO_SHIP' | 'STANDARD' = dbOrder.order_type || (isPod ? 'POD' : 'READY_TO_SHIP');

    let printerStatus = dbOrder.printer_info?.printer_status;
    if (dbOrder.order_status === 'DELIVERED') {
        printerStatus = 'DELIVERED';
    } else if (dbOrder.order_status === 'SHIPPING' && (!printerStatus || ['RECEIVED', 'PRINTING', 'PACKAGED'].includes(printerStatus))) {
        printerStatus = 'SHIPPED';
    } else if (!printerStatus && ['RECEIVED', 'PRINTING', 'PACKAGED', 'SHIPPED', 'DELIVERED', 'REJECTED'].includes(dbOrder.fulfillment_status)) {
        printerStatus = dbOrder.fulfillment_status;
    }

    return {
        id: dbOrder.order_code,
        orderCode: dbOrder.order_code,
        status: dbOrder.order_status,
        approvalStatus,
        fulfillmentStatus: dbOrder.fulfillment_status,
        supplierOrderId: dbOrder.supplier_order_id || dbOrder.printer_info?.supplier_order_id,
        printerInfo: (dbOrder.printer_info || printerStatus || dbOrder.supplier_order_id) ? {
            printerId: dbOrder.printer_info?.printer_id || 'PRINTER_SHOP',
            printerName: dbOrder.printer_info?.printer_name || 'Xưởng In VietCraft',
            supplierOrderId: dbOrder.printer_info?.supplier_order_id || dbOrder.supplier_order_id,
            printerStatus,
            dispatchedAt: dbOrder.printer_info?.dispatched_at ? iso(dbOrder.printer_info.dispatched_at) : undefined,
            rejectionReason: dbOrder.printer_info?.rejection_reason
        } : undefined,
        canApprove,
        isPod,
        orderType,
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

