import mongoose from 'mongoose';
import { Cart } from '../infrastructure/models/cart.model';
import { Product } from '../../product/infrastructure/models/product.model';
import { ProductVariant } from '../../product/infrastructure/models/product-variant.model';
import { PRODUCT_POPULATE, toUserObjectId, VARIANT_POPULATE } from '../utils';

export class CartService {
    /**
     * Mỗi user có ĐÚNG MỘT giỏ: `user_id` là unique index ở tầng DB.
     * Giỏ được tạo ở lần chạm đầu tiên và thuộc về user vĩnh viễn — không nơi nào xoá
     * document này, "xóa giỏ hàng" chỉ làm rỗng `items`.
     *
     * Phải upsert nguyên tử. Kiểu findOne-rồi-create là race: hai request của cùng user
     * chạy song song (FE mở trang thường gọi GET /cart và POST /cart/items gần như cùng
     * lúc) sẽ cùng thấy giỏ chưa tồn tại, cùng create, và cái thứ hai chết vì trùng key.
     */
    private static async ensureCart(ownerId: mongoose.Types.ObjectId) {
        try {
            const cart = await Cart.findOneAndUpdate(
                { user_id: ownerId },
                { $setOnInsert: { user_id: ownerId, items: [] } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            if (cart) return cart;
        } catch (err: any) {
            // Hai upsert vẫn có thể va nhau đúng khoảnh khắc ghi index entry.
            if (err?.code !== 11000) throw err;
        }
        const existing = await Cart.findOne({ user_id: ownerId });
        if (!existing) throw new Error('Không khởi tạo được giỏ hàng');
        return existing;
    }

    static async getCart(userId: string) {
        const ownerId = toUserObjectId(userId);
        await CartService.ensureCart(ownerId);
        return Cart.findOne({ user_id: ownerId })
            .populate(PRODUCT_POPULATE)
            .populate(VARIANT_POPULATE);
    }

    static async addItem(userId: string, payload: { productId: string; variantId?: string; quantity: number; customNotes?: string }) {
        const ownerId = toUserObjectId(userId);
        const { productId, variantId, customNotes } = payload;
        const quantity = Math.max(1, Number(payload.quantity) || 1);

        // Sản phẩm phải tồn tại và còn đang bán.
        if (!mongoose.Types.ObjectId.isValid(productId)) throw new Error('Sản phẩm không hợp lệ');
        const product = await Product.findById(productId).select('title listing_status');
        if (!product) throw new Error('Sản phẩm không tồn tại');
        if (product.listing_status === 'INACTIVE' || product.listing_status === 'EXPIRED') {
            throw new Error(`Sản phẩm "${product.title}" hiện không bán`);
        }

        // Biến thể (nếu có) phải thuộc đúng sản phẩm, còn bán và đủ tồn kho.
        let variant = null;
        if (variantId) {
            if (!mongoose.Types.ObjectId.isValid(variantId)) throw new Error('Biến thể không hợp lệ');
            variant = await ProductVariant.findOne({ _id: variantId, product_id: product._id });
            if (!variant) throw new Error('Biến thể không thuộc sản phẩm này');
            if (variant.is_active === false) throw new Error('Biến thể đã ngừng bán');
        }

        const cart = await CartService.ensureCart(ownerId);

        const existingIndex = cart.items.findIndex(
            item => item.product_id.toString() === productId &&
                (variantId ? item.variant_id?.toString() === variantId : !item.variant_id)
        );

        const currentQty = existingIndex > -1 ? cart.items[existingIndex].quantity : 0;
        if (variant && typeof variant.stock_quantity === 'number' && currentQty + quantity > variant.stock_quantity) {
            throw new Error(`Sản phẩm "${product.title}" chỉ còn ${variant.stock_quantity} sản phẩm`);
        }

        if (existingIndex > -1) {
            cart.items[existingIndex].quantity = currentQty + quantity;
            if (customNotes) cart.items[existingIndex].custom_notes = customNotes;
            cart.items[existingIndex].updated_at = new Date();
        } else {
            cart.items.push({
                product_id: new mongoose.Types.ObjectId(productId),
                variant_id: variantId ? new mongoose.Types.ObjectId(variantId) : undefined,
                quantity,
                is_selected: true,
                custom_notes: customNotes,
                updated_at: new Date()
            });
        }

        await cart.save();
        return this.getCart(userId);
    }

    /** Tìm item trong giỏ của chính user; không thấy thì báo lỗi thay vì im lặng bỏ qua. */
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
        // Chưa có giỏ thì cũng đồng nghĩa món này không nằm trong giỏ. Không gọi
        // ensureCart ở đây: tạo giỏ như tác dụng phụ của một thao tác đang thất bại là sai.
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
        // Chưa có giỏ thì cũng đồng nghĩa món này không nằm trong giỏ. Không gọi
        // ensureCart ở đây: tạo giỏ như tác dụng phụ của một thao tác đang thất bại là sai.
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
        // Chưa có giỏ thì cũng đồng nghĩa món này không nằm trong giỏ. Không gọi
        // ensureCart ở đây: tạo giỏ như tác dụng phụ của một thao tác đang thất bại là sai.
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
