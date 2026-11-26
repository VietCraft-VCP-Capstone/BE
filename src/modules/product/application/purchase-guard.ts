import mongoose from 'mongoose';
import { Shop } from '../infrastructure/models/shop.model';

export const OWN_PRODUCT_MESSAGE = 'Bạn không thể mua sản phẩm của chính gian hàng mình.';

/**
 * Người bán không được tự mua hàng của shop mình (như mọi sàn TMĐT): chặn tự đẩy lượt bán
 * và tự đánh giá sản phẩm của mình.
 */
export async function assertNotOwnProduct(userId: string, shopId: mongoose.Types.ObjectId | string | null | undefined): Promise<void> {
    if (!shopId || !mongoose.Types.ObjectId.isValid(String(userId))) return;
    const own = await Shop.exists({ _id: shopId, owner_id: new mongoose.Types.ObjectId(String(userId)) });
    if (own) throw new Error(OWN_PRODUCT_MESSAGE);
}
