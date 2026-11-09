import mongoose from 'mongoose';
import { Product as MongoProduct } from '../../infrastructure/models/product.model';
import { ProductVariant as MongoVariant } from '../../infrastructure/models/product-variant.model';
import { PROFILE_SIZE, ProfileInput } from './user-profile';
import { SignalItem } from './user-signals';

/** Giá thấp nhất của các variant đang bật, theo productId. */
export async function minPriceOf(ids: mongoose.Types.ObjectId[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    if (ids.length === 0) return prices;
    const rows = await MongoVariant.find({ product_id: { $in: ids }, is_active: { $ne: false } })
        .select('product_id retail_price').lean();
    for (const v of rows) {
        const key = String(v.product_id);
        const p = Number(String(v.retail_price));
        const cur = prices.get(key);
        prices.set(key, cur === undefined ? p : Math.min(cur, p));
    }
    return prices;
}

/** Ghép trọng số với danh mục, tag, giá của 50 sản phẩm tương tác gần nhất. */
export async function loadProfileInputs(items: SignalItem[]): Promise<ProfileInput[]> {
    const top = items.slice(0, PROFILE_SIZE);
    if (top.length === 0) return [];
    const ids = top.map(i => new mongoose.Types.ObjectId(i.productId));
    const [products, prices] = await Promise.all([
        MongoProduct.find({ _id: { $in: ids } }).select('categories tags').lean(),
        minPriceOf(ids),
    ]);
    const byId = new Map(products.map(p => [String(p._id), p]));
    return top.flatMap(i => {
        const p = byId.get(i.productId);
        if (!p) return [];
        return [{ weight: i.weight, categories: p.categories ?? [], tags: p.tags ?? [], price: prices.get(i.productId) ?? 0 }];
    });
}
