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

export async function syncProductDenorm(productId: mongoose.Types.ObjectId | string) {
    if (!productId) return;
    try {
        const pId = typeof productId === 'string' ? new mongoose.Types.ObjectId(productId) : productId;
        const variants = await mongoose.model('ProductVariant').find({ product_id: pId, is_active: true }).lean();
        let min_price = 0;
        let max_price = 0;
        let total_stock = 0;

        if (variants && variants.length > 0) {
            const prices = variants
                .map((v: any) => parseFloat(v.retail_price?.toString() || '0'))
                .filter((p: number) => !isNaN(p) && p > 0);
            min_price = prices.length > 0 ? Math.min(...prices) : 0;
            max_price = prices.length > 0 ? Math.max(...prices) : 0;
            total_stock = variants.reduce((sum: number, v: any) => sum + (Number(v.stock_quantity) || 0), 0);
        }
        await mongoose.model('Product').updateOne(
            { _id: pId },
            { $set: { min_price, max_price, total_stock } }
        );
    } catch (err) {
        // Silently skip if model is not loaded yet during early bootstrap
    }
}

ProductVariantSchema.post('save', function () {
    if (this.product_id) {
        syncProductDenorm(this.product_id);
    }
});

ProductVariantSchema.post('findOneAndUpdate', function (doc) {
    if (doc && doc.product_id) {
        syncProductDenorm(doc.product_id);
    }
});

ProductVariantSchema.post('findOneAndDelete', function (doc) {
    if (doc && doc.product_id) {
        syncProductDenorm(doc.product_id);
    }
});

export const ProductVariant = mongoose.model<IProductVariant>('ProductVariant', ProductVariantSchema, 'product_variants');
