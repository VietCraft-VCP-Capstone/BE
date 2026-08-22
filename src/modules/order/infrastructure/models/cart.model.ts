import mongoose, { Schema, Document } from 'mongoose';

export interface ICartItem {
    product_id: mongoose.Types.ObjectId;
    variant_id?: mongoose.Types.ObjectId;
    quantity: number;
    is_selected: boolean;
    custom_notes?: string;
    custom_design_file?: string;
    updated_at: Date;
}

export interface ICart extends Document {
    user_id: mongoose.Types.ObjectId;
    items: ICartItem[];
    updated_at: Date;
}

const CartItemSchema = new Schema<ICartItem>({
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variant_id: { type: Schema.Types.ObjectId, ref: 'ProductVariant' },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    is_selected: { type: Boolean, default: true },
    custom_notes: { type: String },
    custom_design_file: { type: String },
    updated_at: { type: Date, default: Date.now }
}, { _id: true });

const CartSchema = new Schema<ICart>({
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    items: { type: [CartItemSchema], default: [] }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const Cart = mongoose.model<ICart>('Cart', CartSchema, 'carts');
