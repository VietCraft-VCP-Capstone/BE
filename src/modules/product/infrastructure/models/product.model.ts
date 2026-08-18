import mongoose, { Schema, Document } from 'mongoose';

export interface IDimensions {
    length: number;
    width: number;
    height: number;
}

export interface IProduct extends Document {
    shop_id: mongoose.Types.ObjectId;
    shipping_profile_id: mongoose.Types.ObjectId;
    title: string;
    description: string;
    product_type: 'READY_TO_SHIP' | 'POD_TEMPLATE' | 'CUSTOM_DESIGN_REQUEST';
    allow_customization: boolean;
    customization_type: 'NONE' | 'ONLINE_MOCKUP' | 'DIRECT_CHAT';
    listing_status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
    images: string[];
    tags: string[];
    categories: string[];
    weight_g: number;
    dimensions_cm: IDimensions;
    stock_alert_threshold?: number;
    moderation_status: 'PENDING' | 'APPROVED' | 'REJECTED';
    rejection_reason?: string;
    is_hidden: boolean;
    created_at: Date;
    updated_at: Date;
}

const DimensionsSchema = new Schema<IDimensions>({
    length: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true }
}, { _id: false });

const ProductSchema = new Schema<IProduct>({
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    shipping_profile_id: { type: Schema.Types.ObjectId, ref: 'ShippingProfile', required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    product_type: {
        type: String,
        required: true,
        enum: ['READY_TO_SHIP', 'POD_TEMPLATE', 'CUSTOM_DESIGN_REQUEST']
    },
    allow_customization: { type: Boolean, default: false },
    customization_type: {
        type: String,
        required: true,
        enum: ['NONE', 'ONLINE_MOCKUP', 'DIRECT_CHAT'],
        default: 'NONE'
    },
    listing_status: {
        type: String,
        required: true,
        enum: ['DRAFT', 'ACTIVE', 'INACTIVE', 'EXPIRED'],
        default: 'DRAFT'
    },
    images: { type: [String], default: [] },
    tags: { type: [String], index: true, default: [] },
    categories: { type: [String], default: [] },
    weight_g: { type: Number, required: true },
    dimensions_cm: { type: DimensionsSchema, required: true },
    stock_alert_threshold: { type: Number, default: 5 },
    moderation_status: {
        type: String,
        required: true,
        enum: ['PENDING', 'APPROVED', 'REJECTED'],
        default: 'PENDING'
    },
    rejection_reason: { type: String },
    is_hidden: { type: Boolean, default: false }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

ProductSchema.index({ title: 'text' });

export const Product = mongoose.model<IProduct>('Product', ProductSchema, 'products');
