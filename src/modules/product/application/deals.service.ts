import mongoose from 'mongoose';
import { Product as MongoProduct } from '../infrastructure/models/product.model';
import { ProductVariant as MongoVariant } from '../infrastructure/models/product-variant.model';
import { Shop } from '../infrastructure/models/shop.model';
import { Coupon, DEALS_CACHE_KEY } from '../../promotion/infrastructure/models/coupon.model';
import { calcCouponDiscount } from '../../promotion/application/coupon-math';
import { cacheService } from '../../../shared/services/cache.service';
import { getSoldCounts } from './product-sold';
import { ProductsService, PUBLIC_QUERY } from './product.service';

/**
 * "Giá tốt với mã": sản phẩm đang có mã giảm áp được, giá sau mã tính đúng công thức thanh toán
 * (calcCouponDiscount — có trần max_discount_amount). Một nguồn duy nhất cho trang chủ, tìm kiếm
 * và trang Giá tốt, để giá hiển thị ở đâu cũng khớp số tiền khi thanh toán.
 *
 * Mã được tính là "deal" của sản phẩm khi:
 *  - mã áp cho sản phẩm chỉ định (mọi loại giảm tiền hàng), hoặc
 *  - mã FLASH_SALE áp toàn shop (mọi sản phẩm của shop đó).
 * Mã toàn sàn và mã giảm % / tiền cho cả shop không gắn lên từng sản phẩm (như Shopee: đó là voucher,
 * không phải giá sản phẩm). Mã freeship không giảm tiền hàng nên không tính.
 */

export interface ProductDeal {
    productId: string;
    couponId: string;
    couponCode: string;
    couponTitle: string;
    badge: 'FLASH_SALE' | 'VOUCHER';
    basePrice: number;
    finalPrice: number;
    savings: number;
    /** Nhãn ngắn trên ảnh: "-30K", "-15%". */
    label: string;
    /** Thông số mã để trang chi tiết tính lại theo đúng phân loại khách chọn (cùng công thức). */
    discountType: string;
    discountValue: number;
    maxDiscount: number;
    minOrder: number;
}

const DEAL_TYPES = ['FLASH_SALE', 'PERCENTAGE', 'FIXED_AMOUNT', 'BUNDLE'];
const num = (v: any) => (v == null ? 0 : parseFloat(v.toString()) || 0);
const LIST_CACHE_KEY = DEALS_CACHE_KEY;

async function activeCoupons() {
    const now = new Date();
    return Coupon.find({
        is_active: true,
        start_date: { $lte: now },
        end_date: { $gte: now },
        discount_type: { $in: DEAL_TYPES },
        $or: [{ usage_limit: null }, { $expr: { $lt: ['$used_count', '$usage_limit'] } }],
    }).lean();
}

function targets(c: any): { productIds: string[]; shopId: string | null } {
    if (c.applicable_scope === 'SPECIFIC_PRODUCTS') {
        return { productIds: (c.applicable_product_ids || []).map(String), shopId: null };
    }
    if (c.applicable_scope === 'ALL' && c.shop_id && c.discount_type === 'FLASH_SALE') {
        return { productIds: [], shopId: String(c.shop_id) };
    }
    return { productIds: [], shopId: null };
}

/** Giá hiển thị trên thẻ sản phẩm = giá phân loại đầu tiên (cùng cách mapToProductItemResponse lấy giá). */
async function displayPrices(productIds: mongoose.Types.ObjectId[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await MongoVariant.aggregate([
        { $match: { product_id: { $in: productIds } } },
        { $sort: { _id: 1 } },
        { $group: { _id: '$product_id', price: { $first: '$retail_price' } } },
    ]);
    return new Map(rows.map(r => [String(r._id), num(r.price)]));
}

function labelOf(savings: number, basePrice: number, coupon: any) {
    const val = num(coupon.discount_value);
    const percent = coupon.discount_type === 'PERCENTAGE' || ((coupon.discount_type === 'FLASH_SALE' || coupon.discount_type === 'BUNDLE') && val <= 100);
    if (percent) return `-${Math.max(1, Math.round((savings / basePrice) * 100))}%`;
    return savings >= 1000 ? `-${Math.round(savings / 1000)}K` : `-${Math.round(savings)}đ`;
}

/** Mã tốt nhất cho từng sản phẩm (tiết kiệm nhiều nhất; hoà thì ưu tiên flash sale). */
export function bestDeals(products: Array<{ _id: any; shop_id: any }>, prices: Map<string, number>, coupons: any[]): Map<string, ProductDeal> {
    const byProduct = new Map<string, any[]>();
    const byShop = new Map<string, any[]>();
    for (const c of coupons) {
        const t = targets(c);
        t.productIds.forEach(id => byProduct.set(id, [...(byProduct.get(id) || []), c]));
        if (t.shopId) byShop.set(t.shopId, [...(byShop.get(t.shopId) || []), c]);
    }
    const out = new Map<string, ProductDeal>();
    for (const p of products) {
        const id = String(p._id);
        const base = prices.get(id) || 0;
        if (base <= 0) continue;
        const candidates = [...(byProduct.get(id) || []), ...(byShop.get(String(p.shop_id)) || [])]
            // Mã chỉ của shop khác thì không áp được cho sản phẩm này
            .filter(c => !c.shop_id || String(c.shop_id) === String(p.shop_id));
        let best: ProductDeal | null = null;
        for (const c of candidates) {
            const minOrder = num(c.min_order_value);
            if (minOrder > 0 && base < minOrder) continue; // 1 sản phẩm chưa đủ đơn tối thiểu
            const { discount } = calcCouponDiscount(c.discount_type, num(c.discount_value), num(c.max_discount_amount), base, 0);
            if (discount <= 0) continue;
            const isFlash = c.discount_type === 'FLASH_SALE';
            if (!best || discount > best.savings || (discount === best.savings && isFlash && best.badge !== 'FLASH_SALE')) {
                best = {
                    productId: id,
                    couponId: String(c._id),
                    couponCode: c.code,
                    couponTitle: c.title,
                    badge: isFlash ? 'FLASH_SALE' : 'VOUCHER',
                    basePrice: base,
                    finalPrice: base - discount,
                    savings: discount,
                    label: labelOf(discount, base, c),
                    discountType: c.discount_type,
                    discountValue: num(c.discount_value),
                    maxDiscount: num(c.max_discount_amount),
                    minOrder: minOrder,
                };
            }
        }
        if (best) out.set(id, best);
    }
    return out;
}

async function visibleProducts(filter: Record<string, any>) {
    const restricted = await Shop.find({ reputation_tier: 'RESTRICTED' }).distinct('_id');
    return MongoProduct.find({
        ...PUBLIC_QUERY,
        listing_status: 'ACTIVE',
        ...(restricted.length ? { shop_id: { $nin: restricted } } : {}),
        ...filter,
    }).select('_id shop_id').lean();
}

export const DealsService = {
    /** Mọi sản phẩm đang có giá tốt, xếp theo % tiết kiệm rồi theo lượt bán; có phân trang. */
    async list(page = 1, limit = 20) {
        const safeLimit = Math.min(48, Math.max(1, Math.floor(limit) || 20));
        const safePage = Math.max(1, Math.floor(page) || 1);

        const ranked: ProductDeal[] = await cacheService.getOrSet(LIST_CACHE_KEY, async () => {
            const coupons = await activeCoupons();
            const productIds = new Set<string>();
            const shopIds = new Set<string>();
            coupons.forEach(c => {
                const t = targets(c);
                t.productIds.forEach(id => productIds.add(id));
                if (t.shopId) shopIds.add(t.shopId);
            });
            if (productIds.size === 0 && shopIds.size === 0) return [];
            const or: any[] = [];
            const validIds = [...productIds].filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));
            if (validIds.length) or.push({ _id: { $in: validIds } });
            if (shopIds.size) or.push({ shop_id: { $in: [...shopIds].map(id => new mongoose.Types.ObjectId(id)) } });
            const products = await visibleProducts({ $or: or });
            const ids = products.map(p => p._id as mongoose.Types.ObjectId);
            const [prices, sold] = await Promise.all([displayPrices(ids), getSoldCounts(ids)]);
            const deals = [...bestDeals(products, prices, coupons).values()];
            return deals.sort((a, b) =>
                (b.savings / b.basePrice) - (a.savings / a.basePrice)
                || (sold.get(b.productId) ?? 0) - (sold.get(a.productId) ?? 0)
                || b.savings - a.savings);
        }, 120);

        const total = ranked.length;
        const slice = ranked.slice((safePage - 1) * safeLimit, safePage * safeLimit);
        const items = await ProductsService.getByIds(slice.map(d => d.productId));
        const byId = new Map(items.map(i => [String(i.id), i]));
        return {
            items: slice
                .map(d => byId.has(d.productId) ? { ...byId.get(d.productId)!, deal: d } : null)
                .filter(Boolean),
            total,
            page: safePage,
            limit: safeLimit,
            totalPages: Math.max(1, Math.ceil(total / safeLimit)),
        };
    },

    /** Giá tốt cho một nhóm sản phẩm cụ thể (thẻ sản phẩm ở trang chủ, tìm kiếm, gợi ý). */
    async lookup(ids: string[]): Promise<Record<string, ProductDeal>> {
        const valid = [...new Set(ids)].filter(id => mongoose.Types.ObjectId.isValid(id)).slice(0, 100);
        if (valid.length === 0) return {};
        const coupons = await activeCoupons();
        if (coupons.length === 0) return {};
        const products = await visibleProducts({ _id: { $in: valid.map(id => new mongoose.Types.ObjectId(id)) } });
        const prices = await displayPrices(products.map(p => p._id as mongoose.Types.ObjectId));
        return Object.fromEntries(bestDeals(products, prices, coupons));
    },

    async invalidate() {
        await cacheService.del(LIST_CACHE_KEY).catch(() => {});
    },
};
