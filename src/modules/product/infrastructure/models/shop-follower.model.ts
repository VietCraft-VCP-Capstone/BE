import mongoose, { Schema, Document } from 'mongoose';

export interface IShopFollower extends Document {
    shop_id: mongoose.Types.ObjectId;
    buyer_ids: mongoose.Types.ObjectId[];
}

const ShopFollowerSchema = new Schema<IShopFollower>({
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, unique: true, index: true },
    buyer_ids: [{ type: Schema.Types.ObjectId, ref: 'User', default: [] }]
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const ShopFollower = mongoose.model<IShopFollower>('ShopFollower', ShopFollowerSchema, 'shop_followers');
