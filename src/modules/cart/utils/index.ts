import mongoose from "mongoose";

export const PRODUCT_POPULATE = {
    path: 'items.product_id',
    // shop dùng `shop_name`, KHÔNG có field `name`.
    select: 'title images retail_price base_cost product_type shop_id listing_status',
    populate: {
        path: 'shop_id',
        select: 'shop_name logo'
    }
};

export const VARIANT_POPULATE = {
    path: 'items.variant_id',
    select: 'sku color size material retail_price base_cost stock_quantity mockup_image is_active'
};

// Giỏ hàng luôn khoá theo user_id lấy từ token — mọi thao tác item chỉ chạm giỏ của chính user đó.

export function toUserObjectId(userId: string) {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error('Phiên đăng nhập không hợp lệ');
    }
    return new mongoose.Types.ObjectId(userId);
}