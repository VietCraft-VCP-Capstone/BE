import mongoose from 'mongoose';
import { Cart } from '../infrastructure/models/cart.model';
import { Product } from '../../product/infrastructure/models/product.model';
import { ProductVariant } from '../../product/infrastructure/models/product-variant.model';
import { PRODUCT_POPULATE, toUserObjectId, VARIANT_POPULATE } from '../utils';

export class CartService {

    private static async ensureCart(ownerId: mongoose.Types.ObjectId) {
        try {
            const cart = await Cart.findOneAndUpdate(
                { user_id: ownerId },
                { $setOnInsert: { user_id: ownerId, items: [] } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            if (cart) return cart;
        } catch (err: any) {
            if (err?.code !== 11000) throw err;
        }
        const existing = await Cart.findOne({ user_id: ownerId });
        if (!existing) throw new Error('Không khởi tạo được giỏ hàng');
        return existing;
    }

    private static mergeDuplicateItems(cart: any): boolean {
        if (!cart || !Array.isArray(cart.items) || cart.items.length <= 1) return false;

        const mergedMap = new Map<string, any>();
        let hasDuplicates = false;

        for (const item of cart.items) {
            const pId = (item.product_id?._id || item.product_id)?.toString();
            const vId = (item.variant_id?._id || item.variant_id)?.toString() || '';
            const key = `${pId}::${vId}`;

            if (mergedMap.has(key)) {
                const existing = mergedMap.get(key);
                existing.quantity = (Number(existing.quantity) || 1) + (Number(item.quantity) || 1);
                if (item.custom_notes && !existing.custom_notes) {
                    existing.custom_notes = item.custom_notes;
                }
                existing.updated_at = new Date();
                hasDuplicates = true;
            } else {
                mergedMap.set(key, item);
            }
        }

        if (hasDuplicates) {
            cart.items = Array.from(mergedMap.values());
        }
        return hasDuplicates;
    }

    static async getCart(userId: string) {
        const ownerId = toUserObjectId(userId);
        const cart = await CartService.ensureCart(ownerId);

        // Tự động gán biến thể cho các sản phẩm trong giỏ hàng nếu đang thiếu variant_id
        if (cart && Array.isArray(cart.items)) {
            let hasModified = false;
            for (const item of cart.items) {
                if (!item.variant_id && item.product_id) {
                    const fallbackVariant = await ProductVariant.findOne({
                        product_id: item.product_id,
                        is_active: { $ne: false }
                    }) || await ProductVariant.findOne({ product_id: item.product_id });

                    if (fallbackVariant) {
                        item.variant_id = fallbackVariant._id as any;
                        hasModified = true;
                    }
                }
            }
            if (CartService.mergeDuplicateItems(cart)) {
                hasModified = true;
            }
            if (hasModified) {
                await cart.save();
            }
        }

        return Cart.findOne({ user_id: ownerId })
            .populate(PRODUCT_POPULATE)
            .populate(VARIANT_POPULATE);
    }

    static async addItem(userId: string, payload: { productId?: string; product_id?: string; variantId?: string; variant_id?: string; quantity: number; customNotes?: string }) {
        const ownerId = toUserObjectId(userId);
        const productId = String(payload.productId || payload.product_id || '').trim();
        const variantId = (payload.variantId || payload.variant_id) ? String(payload.variantId || payload.variant_id).trim() : undefined;
        const customNotes = payload.customNotes;
        const quantity = Math.max(1, Number(payload.quantity) || 1);

        if (!mongoose.Types.ObjectId.isValid(productId)) throw new Error('Sản phẩm không hợp lệ');
        const product = await Product.findById(productId).select('title listing_status');
        if (!product) throw new Error('Sản phẩm không tồn tại');
        if (product.listing_status === 'INACTIVE' || product.listing_status === 'EXPIRED') {
            throw new Error(`Sản phẩm "${product.title}" hiện không bán`);
        }

        let variant = null;
        if (variantId && mongoose.Types.ObjectId.isValid(variantId)) {
            variant = await ProductVariant.findOne({ _id: variantId, product_id: product._id });
            if (variant && variant.is_active === false) {
                throw new Error('Biến thể đã ngừng bán');
            }
        }
        if (!variant) {
            // Tự động lấy biến thể đầu tiên còn hoạt động của sản phẩm
            variant = await ProductVariant.findOne({ product_id: product._id, is_active: { $ne: false } })
                || await ProductVariant.findOne({ product_id: product._id });
        }

        const cart = await CartService.ensureCart(ownerId);

        // Chuẩn hóa và gộp các mặt hàng trùng lặp nếu có từ trước
        CartService.mergeDuplicateItems(cart);

        const targetVariantId = variant ? variant._id.toString() : (variantId || undefined);

        // Tìm kiếm xem đã có trong giỏ chưa
        const existingIndex = cart.items.findIndex(
            (item: any) => {
                const itemProdId = (item.product_id?._id || item.product_id)?.toString();
                const itemVarId = (item.variant_id?._id || item.variant_id)?.toString();

                if (itemProdId !== productId) return false;
                if (targetVariantId) {
                    return itemVarId === targetVariantId || !itemVarId;
                }
                return !itemVarId;
            }
        );

        const currentQty = existingIndex > -1 ? cart.items[existingIndex].quantity : 0;
        if (variant && typeof variant.stock_quantity === 'number' && currentQty + quantity > variant.stock_quantity) {
            throw new Error(`Sản phẩm "${product.title}" chỉ còn ${variant.stock_quantity} sản phẩm`);
        }

        if (existingIndex > -1) {
            // Đã có -> Chỉ tăng số lượng
            cart.items[existingIndex].quantity = currentQty + quantity;
            if (targetVariantId && !cart.items[existingIndex].variant_id) {
                cart.items[existingIndex].variant_id = variant ? variant._id : new mongoose.Types.ObjectId(targetVariantId);
            }
            if (customNotes) cart.items[existingIndex].custom_notes = customNotes;
            cart.items[existingIndex].updated_at = new Date();
        } else {
            // Chưa có -> Mới thêm dòng mới
            cart.items.push({
                product_id: new mongoose.Types.ObjectId(productId),
                variant_id: variant ? variant._id : (variantId && mongoose.Types.ObjectId.isValid(variantId) ? new mongoose.Types.ObjectId(variantId) : undefined),
                quantity,
                is_selected: true,
                custom_notes: customNotes,
                updated_at: new Date()
            });
        }

        CartService.mergeDuplicateItems(cart);
        await cart.save();
        return this.getCart(userId);
    }

    private static findItemOrThrow(cart: any, itemId: string) {
        const item = cart.items.find(
            (i: any) => i._id?.toString() === itemId || i.product_id.toString() === itemId
        );
        if (!item) throw new Error('Sản phẩm không có trong giỏ hàng');
        return item;
    }

    static async updateQuantity(userId: string, itemId: string, quantity: number) {
        const ownerId = toUserObjectId(userId);
        const qty = Number(quantity);
        if (!Number.isFinite(qty) || qty < 1) throw new Error('Số lượng phải lớn hơn 0');

        const cart = await Cart.findOne({ user_id: ownerId });
        if (!cart) throw new Error('Sản phẩm không có trong giỏ hàng');

        const item = this.findItemOrThrow(cart, itemId);
        if (item.variant_id) {
            const variant = await ProductVariant.findById(item.variant_id).select('stock_quantity is_active');
            if (variant?.is_active === false) throw new Error('Biến thể đã ngừng bán');
            if (variant && typeof variant.stock_quantity === 'number' && qty > variant.stock_quantity) {
                throw new Error(`Chỉ còn ${variant.stock_quantity} sản phẩm`);
            }
        }

        item.quantity = Math.floor(qty);
        item.updated_at = new Date();
        await cart.save();
        return this.getCart(userId);
    }

    static async toggleSelect(userId: string, itemId: string, isSelected: boolean) {
        const ownerId = toUserObjectId(userId);
        const cart = await Cart.findOne({ user_id: ownerId });
        if (!cart) throw new Error('Sản phẩm không có trong giỏ hàng');

        const item = this.findItemOrThrow(cart, itemId);
        item.is_selected = isSelected;
        item.updated_at = new Date();
        await cart.save();
        return this.getCart(userId);
    }

    static async removeItem(userId: string, itemId: string) {
        const ownerId = toUserObjectId(userId);
        const cart = await Cart.findOne({ user_id: ownerId });
        if (!cart) throw new Error('Sản phẩm không có trong giỏ hàng');

        const before = cart.items.length;
        cart.items = cart.items.filter((i: any) => i._id?.toString() !== itemId) as typeof cart.items;
        if (cart.items.length === before) throw new Error('Sản phẩm không có trong giỏ hàng');

        await cart.save();
        return this.getCart(userId);
    }

    static async clearCart(userId: string) {
        const ownerId = toUserObjectId(userId);
        const cart = await Cart.findOne({ user_id: ownerId });
        if (cart) {
            cart.items = [] as unknown as typeof cart.items;
            await cart.save();
        }
        return { message: 'Đã xóa toàn bộ giỏ hàng' };
    }
}
