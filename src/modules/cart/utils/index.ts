import mongoose from "mongoose";

export const PRODUCT_POPULATE = {
    path: 'items.product_id',
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


/** Chuẩn hoá danh sách id dòng giỏ từ body: chỉ giữ chuỗi không rỗng, bỏ trùng, tối đa 200. */
export function normalizeItemIds(raw: unknown): string[] {
    if (!Array.isArray(raw)) throw new Error('Danh sách sản phẩm không hợp lệ');
    const ids = Array.from(new Set(raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map(v => v.trim())));
    if (ids.length > 200) throw new Error('Chọn tối đa 200 sản phẩm mỗi lần');
    return ids;
}

/** Đặt đúng tập dòng được chọn: dòng có trong danh sách thì chọn, còn lại bỏ chọn. Trả về số dòng đổi trạng thái. */
export function applySelection(items: { _id?: any; is_selected?: boolean; updated_at?: Date }[], selectedIds: string[], now = new Date()): number {
    const wanted = new Set(selectedIds);
    let changed = 0;
    for (const item of items) {
        const next = wanted.has(String(item._id));
        if (Boolean(item.is_selected) !== next) {
            item.is_selected = next;
            item.updated_at = now;
            changed += 1;
        }
    }
    return changed;
}

export function toUserObjectId(userId: string) {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error('Phiên đăng nhập không hợp lệ');
    }
    return new mongoose.Types.ObjectId(userId);
}