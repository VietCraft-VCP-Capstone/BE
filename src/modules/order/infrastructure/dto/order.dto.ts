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

export function mapDbOrderToResponse(dbOrder: any): OrderResponse {
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

    return {
        id: dbOrder.order_code,
        buyerId: dbOrder.buyer_id?.toString() || '',
        shopName: dbOrder.shop_id?.shop_name || 'VietCraft Shop',
        shopLogo: dbOrder.shop_id?.logo || PLACEHOLDER_SHOP_LOGO,
        items: (dbOrder.items || []).map((it: any) => {
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
            return {
                productId: (it.product_id?._id || it.product_id)?.toString() || '',
                variantId: it.variant_id?.toString() || '',
                title: it.title,
                color: it.color,
                size: it.size,
                quantity: it.quantity,
                price: num(it.retail_price),
                image
            };
        }),
        totalAmount,
        shippingFee,
        status: feStatus,
        paymentGateway: dbOrder.payment_method?.toLowerCase() || 'vnpay',
        paymentMethod: dbOrder.payment_method,
        shippingProvider: dbOrder.shipping_details?.carrier?.toLowerCase() || 'ghn',
        shippingCode: dbOrder.shipping_details?.tracking_number,
        paymentStatus: dbOrder.payment_status,
        createdAt: dbOrder.created_at || dbOrder.createdAt || new Date(),
        shippingAddress: {
            recipient_name: dbOrder.shipping_address?.recipient_name || '',
            phone: dbOrder.shipping_address?.phone || '',
            address_detail: dbOrder.shipping_address?.address_detail || ''
        }
    };
}