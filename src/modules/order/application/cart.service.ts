import mongoose from 'mongoose';
import { Cart } from '../infrastructure/models/cart.model';

export class CartService {
    static async getCart(userId: string) {
        let cart = await Cart.findOne({ user_id: userId }).populate({
            path: 'items.product_id',
            select: 'title images retail_price base_cost product_type shop_id listing_status'
        });
        if (!cart) {
            cart = await Cart.create({ user_id: userId, items: [] });
        }
        return cart;
    }

    static async addItem(userId: string, payload: { productId: string; variantId?: string; quantity: number; customNotes?: string }) {
        const { productId, variantId, quantity, customNotes } = payload;
        let cart = await Cart.findOne({ user_id: userId });
        if (!cart) {
            cart = await Cart.create({ user_id: userId, items: [] });
        }

        const existingIndex = cart.items.findIndex(
            item => item.product_id.toString() === productId && (variantId ? item.variant_id?.toString() === variantId : true)
        );

        if (existingIndex > -1) {
            cart.items[existingIndex].quantity += quantity;
            if (customNotes) cart.items[existingIndex].custom_notes = customNotes;
            cart.items[existingIndex].updated_at = new Date();
        } else {
            cart.items.push({
                product_id: new mongoose.Types.ObjectId(productId),
                variant_id: variantId ? new mongoose.Types.ObjectId(variantId) : undefined,
                quantity: quantity || 1,
                is_selected: true,
                custom_notes: customNotes,
                updated_at: new Date()
            });
        }

        await cart.save();
        return this.getCart(userId);
    }

    static async updateQuantity(userId: string, itemId: string, quantity: number) {
        const cart = await Cart.findOne({ user_id: userId });
        if (!cart) throw new Error('Giỏ hàng không tồn tại');

        const item = cart.items.find(i => (i as any)._id?.toString() === itemId || i.product_id.toString() === itemId);
        if (item) {
            item.quantity = quantity;
            item.updated_at = new Date();
            await cart.save();
        }
        return this.getCart(userId);
    }

    static async toggleSelect(userId: string, itemId: string, isSelected: boolean) {
        const cart = await Cart.findOne({ user_id: userId });
        if (!cart) throw new Error('Giỏ hàng không tồn tại');

        const item = cart.items.find(i => (i as any)._id?.toString() === itemId || i.product_id.toString() === itemId);
        if (item) {
            item.is_selected = isSelected;
            item.updated_at = new Date();
            await cart.save();
        }
        return this.getCart(userId);
    }

    static async removeItem(userId: string, itemId: string) {
        const cart = await Cart.findOne({ user_id: userId });
        if (!cart) throw new Error('Giỏ hàng không tồn tại');

        cart.items = cart.items.filter(i => (i as any)._id?.toString() !== itemId && i.product_id.toString() !== itemId);
        await cart.save();
        return this.getCart(userId);
    }

    static async clearCart(userId: string) {
        const cart = await Cart.findOne({ user_id: userId });
        if (cart) {
            cart.items = [];
            await cart.save();
        }
        return { message: 'Đã xóa toàn bộ giỏ hàng' };
    }
}
