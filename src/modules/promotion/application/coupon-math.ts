import type { CouponDiscountType } from '../infrastructure/models/coupon.model';

/** Số tiền 1 voucher giảm: mã hàng không vượt tiền hàng đủ điều kiện, mã ship không vượt phí ship. */
export function calcCouponDiscount(
    type: CouponDiscountType,
    value: number,
    maxDiscount: number,
    eligibleSubtotal: number,
    shippingFee: number,
): { discount: number; target: 'PRODUCT' | 'SHIPPING' } {
    const base = Math.max(0, eligibleSubtotal);
    const ship = Math.max(0, shippingFee);
    if (type === 'FREE_SHIPPING') {
        return { discount: Math.round(Math.min(value > 0 ? value : ship, ship)), target: 'SHIPPING' };
    }
    // FLASH_SALE/BUNDLE: giá trị <= 100 hiểu là %, lớn hơn là số tiền cố định
    const isPercent = type === 'PERCENTAGE' || ((type === 'FLASH_SALE' || type === 'BUNDLE') && value <= 100);
    let raw = isPercent ? base * (value / 100) : value;
    if (isPercent && maxDiscount > 0) raw = Math.min(raw, maxDiscount);
    return { discount: Math.max(0, Math.min(Math.round(raw), base)), target: 'PRODUCT' };
}

/** Tổng đơn khi áp đồng thời 1 mã hàng + 1 mã ship; kẹp lại lần nữa để tổng không bao giờ âm. */
export function computeOrderTotals(subtotal: number, shippingFee: number, productDiscount: number, shippingDiscount: number) {
    const productOff = Math.max(0, Math.min(productDiscount, subtotal));
    const shippingOff = Math.max(0, Math.min(shippingDiscount, shippingFee));
    return {
        productDiscount: productOff,
        shippingDiscount: shippingOff,
        couponDiscount: productOff + shippingOff,
        total: Math.max(0, subtotal - productOff + shippingFee - shippingOff),
    };
}
