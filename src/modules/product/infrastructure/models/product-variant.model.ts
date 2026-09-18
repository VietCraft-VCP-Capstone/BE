import mongoose, { Schema, Document } from 'mongoose';

export interface IProductVariant extends Document {
    product_id: mongoose.Types.ObjectId;
    sku: string;
    color?: string;
    size?: string;
    material?: string;
    base_cost: mongoose.Types.Decimal128;
    retail_price: mongoose.Types.Decimal128;
    stock_quantity: number;
    mockup_image?: string;
    provider_sku?: string;
    is_active: boolean;
}

const ProductVariantSchema = new Schema<IProductVariant>({
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    sku: { type: String, required: true, index: true },
    color: { type: String },
    size: { type: String },
    material: { type: String },
    base_cost: { type: Schema.Types.Decimal128, required: true },
    retail_price: { type: Schema.Types.Decimal128, required: true },
    stock_quantity: { type: Number, required: true, default: 0 },
    mockup_image: { type: String },
    provider_sku: { type: String, trim: true, index: true },
    is_active: { type: Boolean, default: true }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const ProductVariant = mongoose.model<IProductVariant>('ProductVariant', ProductVariantSchema, 'product_variants');
