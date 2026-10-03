import { OrderResponse } from "../../types";
import { PLACEHOLDER_ITEM_IMAGE, PLACEHOLDER_SHOP_LOGO } from "../../types";
import { num } from "../../utils";

const BACKEND_BASE = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8080}`;

/** Chuyển path tương đối (/images/..., /uploads/...) thành URL đầy đủ */
function resolveImageUrl(url: string | undefined | null): string {
    if (!url) return PLACEHOLDER_ITEM_IMAGE;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('/')) return `${BACKEND_BASE}${url}`;
    return url;
}

export function mapDbOrderToResponse(dbOrder: any, reviewsMap?: Map<string, any>): OrderResponse {
    const subtotal = num(dbOrder.financial_breakdown?.subtotal);
    const shippingFee = num(dbOrder.financial_breakdown?.shipping_fee);
    const discount = num(dbOrder.financial_breakdown?.coupon_discount);
    const totalAmount = subtotal + shippingFee - discount;

    let feStatus: OrderResponse['status'] = 'pending';
    switch (dbOrder.order_status) {
        case 'ORDERED':
        case 'PENDING_DESIGN':
            feStatus = 'pending';
            break;
        case 'PROCESSING':
            feStatus = 'paid';
            break;
        case 'SHIPPING':
            feStatus = 'shipping';
            break;
        case 'DELIVERED':
            feStatus = 'completed';
            break;
        case 'CANCELLED':
            feStatus = 'cancelled';
            break;
    }

    const orderMongoId = dbOrder._id?.toString() || '';
    const orderCode = dbOrder.order_code || '';

    const items = (dbOrder.items || []).map((it: any) => {
        // it.product_id có thể đã được populate thành object Product
        const populatedProduct = it.product_id && typeof it.product_id === 'object' && it.product_id.images
            ? it.product_id
            : null;
        // Ưu tiên: ảnh Cloudinary mới nhất từ product → ảnh đã lưu trong order → placeholder
        const productImg = populatedProduct?.images?.[0];
        const storedImg = it.image;
        const image = resolveImageUrl(
            (productImg && (productImg.startsWith('http://') || productImg.startsWith('https://'))) ? productImg
            : (storedImg && (storedImg.startsWith('http://') || storedImg.startsWith('https://'))) ? storedImg
            : productImg || storedImg
        );

        const prodId = (it.product_id?._id || it.product_id)?.toString() || '';
        let matchedReview: any = null;
        if (reviewsMap && prodId) {
            matchedReview = reviewsMap.get(`${orderMongoId}_${prodId}`) || reviewsMap.get(`${orderCode}_${prodId}`);
        }

        const isReviewed = Boolean(matchedReview);

        return {
            productId: prodId,
            variantId: it.variant_id?.toString() || '',
            title: it.title,
            color: it.color,
            size: it.size,
            quantity: it.quantity,
            price: num(it.retail_price),
            image,
            is_reviewed: isReviewed,
            review: matchedReview ? {
                id: (matchedReview._id || matchedReview.id)?.toString(),
                rating: matchedReview.rating,
                comment: matchedReview.comment || '',
                images: matchedReview.images || [],
                createdAt: matchedReview.created_at || matchedReview.createdAt,
                updatedAt: matchedReview.updated_at || matchedReview.updatedAt
            } : null
        };
    });

    const isOrderReviewed = items.length > 0 && items.every((it: any) => it.is_reviewed);

    const isPod = Boolean(
        dbOrder.is_pod ||
        dbOrder.order_type === 'POD' ||
        dbOrder.items?.some((it: any) => it.design_file_url) ||
        Boolean(dbOrder.supplier_order_id || dbOrder.printer_info?.supplier_order_id)
    );

    return {
        id: dbOrder.order_code,
        _id: orderMongoId,
        orderCode: orderCode,
        buyerId: dbOrder.buyer_id?.toString() || '',
        shopId: (dbOrder.shop_id?._id || dbOrder.shop_id)?.toString() || '',
        shopName: dbOrder.shop_id?.shop_name || 'VietCraft Shop',
        shopLogo: dbOrder.shop_id?.logo || PLACEHOLDER_SHOP_LOGO,
        items,
        totalAmount,
        shippingFee,
        status: feStatus,
        paymentGateway: dbOrder.payment_method?.toLowerCase() || 'vnpay',
        paymentMethod: dbOrder.payment_method,
        couponCode: dbOrder.coupon_code || null,
        shippingProvider: dbOrder.shipping_details?.carrier?.toLowerCase() || 'ghn',
        shippingCode: dbOrder.shipping_details?.tracking_number,
        paymentStatus: dbOrder.payment_status,
        isStatusSimulation: Boolean(dbOrder.is_status_simulation),
        createdAt: dbOrder.created_at || dbOrder.createdAt || new Date(),
        is_reviewed: isOrderReviewed,
        isPod,
        orderType: dbOrder.order_type || (isPod ? 'POD' : 'READY_TO_SHIP'),
        fulfillmentStatus: dbOrder.fulfillment_status,
        printerInfo: dbOrder.printer_info ? {
            printerId: dbOrder.printer_info.printer_id,
            printerName: dbOrder.printer_info.printer_name,
            supplierOrderId: dbOrder.printer_info.supplier_order_id || dbOrder.supplier_order_id,
            printerStatus: dbOrder.printer_info.printer_status,
            rejectionReason: dbOrder.printer_info.rejection_reason
        } : undefined,
        shippingAddress: {
            recipient_name: dbOrder.shipping_address?.recipient_name || '',
            phone: dbOrder.shipping_address?.phone || '',
            address_detail: dbOrder.shipping_address?.address_detail || ''
        }
    };
}
