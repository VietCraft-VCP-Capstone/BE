import mongoose from 'mongoose';
import { Shop } from '../infrastructure/models/shop.model';

export const OWN_PRODUCT_MESSAGE = 'Bạn không thể mua sản phẩm của chính gian hàng mình.';
export const MAX_QUANTITY_PER_LINE = 999;

/**
 * Chỉ bán sản phẩm đang hiển thị công khai: bản nháp, bị gỡ (UNPUBLISHED) hay bị ẩn thì không mua được
 * dù biết mã sản phẩm và gọi thẳng API.
 */
export function assertPurchasable(product: { title?: string; listing_status?: string; status?: string; is_hidden?: boolean }): void {
    if (product.listing_status !== 'ACTIVE' || product.status !== 'PUBLISHED' || product.is_hidden === true) {
        throw new Error(`Sản phẩm "${product.title || ''}" hiện không bán`);
    }
}

/** Số lượng phải là số nguyên 1..999 (từng nhận 1.5 làm tiền và tồn kho thành số lẻ). */
export function parseQuantity(value: unknown, fallback?: number): number {
    const raw = value === undefined || value === null || value === '' ? fallback : value;
    const qty = Number(raw);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QUANTITY_PER_LINE) {
        throw new Error(`Số lượng phải là số nguyên từ 1 đến ${MAX_QUANTITY_PER_LINE}.`);
    }
    return qty;
}

/**
 * Người bán không được tự mua hàng của shop mình (như mọi sàn TMĐT): chặn tự đẩy lượt bán
 * và tự đánh giá sản phẩm của mình.
 */
export async function assertNotOwnProduct(userId: string, shopId: mongoose.Types.ObjectId | string | null | undefined): Promise<void> {
    if (!shopId || !mongoose.Types.ObjectId.isValid(String(userId))) return;
    const own = await Shop.exists({ _id: shopId, owner_id: new mongoose.Types.ObjectId(String(userId)) });
    if (own) throw new Error(OWN_PRODUCT_MESSAGE);
}
