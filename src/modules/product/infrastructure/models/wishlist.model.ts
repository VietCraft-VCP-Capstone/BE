import mongoose, { Schema, Document } from 'mongoose';

export interface IWishlist extends Document {
    user_id: mongoose.Types.ObjectId;
    product_ids: mongoose.Types.ObjectId[];
}

const WishlistSchema = new Schema<IWishlist>({
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    product_ids: [{ type: Schema.Types.ObjectId, ref: 'Product', default: [] }]
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const Wishlist = mongoose.model<IWishlist>('Wishlist', WishlistSchema, 'wishlists');
