import mongoose, { Schema, Document } from 'mongoose';
import { normalizeVi, nfcLower, buildPrefixes } from '../../../../shared/utils/vietnamese-search.util';

export interface IDimensions {
    length: number;
    width: number;
    height: number;
}

export interface IProduct extends Document {
    shop_id: mongoose.Types.ObjectId;
    shipping_profile_id: mongoose.Types.ObjectId;
    title: string;
    slug: string;
    description: string;
    product_type: 'READY_TO_SHIP' | 'POD_TEMPLATE' | 'CUSTOM_DESIGN_REQUEST';
    allow_customization: boolean;
    customization_type: 'NONE' | 'ONLINE_MOCKUP' | 'DIRECT_CHAT';
    listing_status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
    status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED';
    unpublish_reason?: string;
    images: string[];
    tags: string[];
    materials: string[];
    categories: string[];
    tag_ids: mongoose.Types.ObjectId[];
    category_ids: mongoose.Types.ObjectId[];
    weight_g: number;
    dimensions_cm: IDimensions;
    stock_alert_threshold?: number;
    // Seller portal: 3 field dưới trước đây bị nhét nhờ vào stock_alert_threshold /
    // rejection_reason / tags[0] — vốn thuộc về hệ tồn kho, kiểm duyệt và hệ tag.
    original_price?: number;
    display_rank?: number;
    location?: string;
    moderation_status: 'PENDING' | 'APPROVED' | 'REJECTED';
    rejection_reason?: string;
    is_hidden: boolean;
    // POD: phôi in (id bên Printer) + cách đặt design lên phôi.
    blank_id?: string;
    printer_id?: string;
    printer_name?: string;
    design_placements?: {
        design_id?: mongoose.Types.ObjectId;
        print_area_key: string;
        x: number;
        y: number;
        scale: number;
        rotation: number;
        layers?: any[];
    }[];
    average_rating?: number;
    rating_count?: number;
    title_norm?: string;
    title_lc?: string;
    title_prefixes?: string[];
    tags_norm?: string[];
    categories_norm?: string[];
    description_norm?: string;
    min_price?: number;
    max_price?: number;
    total_stock?: number;
    sold_count?: number;
    // Do script seed ghi thẳng; khai báo để query lọc seed_ref có kiểu.
    seed_ref?: string;
    created_at: Date;
    updated_at: Date;
}

// Layer: 1 phần tử trên 1 mặt. type=image|text|shape. Toạ độ x/y/scale/rotation theo px ảnh phôi.
const LayerSchema = new Schema({
    type: { type: String, enum: ['image', 'text', 'shape'], required: true },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    scale: { type: Number, default: 1 },
    rotation: { type: Number, default: 0 },
    // image
    design_id: { type: Schema.Types.ObjectId, ref: 'Design' },
    // text
    text: { type: String },
    font_family: { type: String },
    font_size: { type: Number },
    font_weight: { type: String },
    color: { type: String },
    align: { type: String },
    // shape
    shape: { type: String },          // rect | circle | triangle | star | heart
    fill: { type: String },
    stroke: { type: String },
    stroke_width: { type: Number },
    width: { type: Number },          // kích thước gốc của text/shape (px)
    height: { type: Number },
}, { _id: false });

const DesignPlacementSchema = new Schema({
    design_id: { type: Schema.Types.ObjectId, ref: 'Design' },   // legacy: 1 ảnh/mặt (giữ tương thích)
    print_area_key: { type: String, required: true },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    scale: { type: Number, default: 1 },
    rotation: { type: Number, default: 0 },
    layers: { type: [LayerSchema], default: [] },
}, { _id: false });

const DimensionsSchema = new Schema<IDimensions>({
    length: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true }
}, { _id: false });

const ProductSchema = new Schema<IProduct>({
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    shipping_profile_id: { type: Schema.Types.ObjectId, ref: 'ShippingProfile', required: true },
    title: { type: String, required: true },
    slug: { type: String, unique: true, sparse: true, index: true },
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
    status: {
        type: String,
        required: true,
        enum: ['DRAFT', 'PUBLISHED', 'UNPUBLISHED'],
        default: 'DRAFT',
        index: true
    },
    unpublish_reason: { type: String },
    images: { type: [String], default: [] },
    tags: { type: [String], index: true, default: [] },
    materials: { type: [String], default: [] },
    categories: { type: [String], default: [] },
    tag_ids: { type: [{ type: Schema.Types.ObjectId, ref: 'Tag' }], index: true, default: [] },
    category_ids: { type: [{ type: Schema.Types.ObjectId, ref: 'Category' }], index: true, default: [] },
    weight_g: { type: Number, required: true },
    dimensions_cm: { type: DimensionsSchema, required: true },
    stock_alert_threshold: { type: Number, default: 5 },
    original_price: { type: Number },
    display_rank: { type: Number, default: 1 },
    location: { type: String },
    moderation_status: {
        type: String,
        required: true,
        enum: ['PENDING', 'APPROVED', 'REJECTED'],
        default: 'PENDING'
    },
    rejection_reason: { type: String },
    is_hidden: { type: Boolean, default: false },
    blank_id: { type: String, index: true },
    printer_id: { type: String, index: true },
    printer_name: { type: String },
    design_placements: { type: [DesignPlacementSchema], default: [] },
    average_rating: { type: Number, default: 5.0, min: 0, max: 5, index: true },
    rating_count: { type: Number, default: 0 },
    title_norm: { type: String },
    title_lc: { type: String },
    title_prefixes: { type: [String], default: [] },
    tags_norm: { type: [String], default: [] },
    categories_norm: { type: [String], default: [] },
    description_norm: { type: String },
    min_price: { type: Number, default: 0 },
    max_price: { type: Number, default: 0 },
    total_stock: { type: Number, default: 0 },
    sold_count: { type: Number, default: 0 }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

ProductSchema.pre('save', function (next) {
    if (this.isModified('title') || !this.title_norm) {
        this.title_norm = normalizeVi(this.title || '');
        this.title_lc = nfcLower(this.title || '');
        this.title_prefixes = buildPrefixes(this.title_norm);
    }
    if (this.isModified('tags') || !this.tags_norm || this.tags_norm.length === 0) {
        this.tags_norm = Array.isArray(this.tags) ? this.tags.map(t => normalizeVi(t)).filter(Boolean) : [];
    }
    if (this.isModified('categories') || !this.categories_norm || this.categories_norm.length === 0) {
        this.categories_norm = Array.isArray(this.categories) ? this.categories.map(c => normalizeVi(c)).filter(Boolean) : [];
    }
    if (this.isModified('description') || !this.description_norm) {
        this.description_norm = normalizeVi(this.description || '');
    }
    next();
});

ProductSchema.index(
    { title_norm: 'text', tags_norm: 'text', categories_norm: 'text', description_norm: 'text' },
    {
        name: 'ProductTextSearchIndex',
        weights: { title_norm: 10, tags_norm: 5, categories_norm: 3, description_norm: 1 },
        default_language: 'none'
    }
);
ProductSchema.index({ status: 1, is_hidden: 1, created_at: -1 });
ProductSchema.index({ status: 1, is_hidden: 1, categories: 1 });
ProductSchema.index({ status: 1, is_hidden: 1, min_price: 1 });
ProductSchema.index({ status: 1, is_hidden: 1, total_stock: 1 });
ProductSchema.index({ title_prefixes: 1 });
ProductSchema.index({ title_norm: 1 });
ProductSchema.index({ tags_norm: 1 });
ProductSchema.index({ categories_norm: 1 });
ProductSchema.index({ shop_id: 1, status: 1 });
ProductSchema.index({ listing_status: 1, status: 1 });

export const Product = mongoose.model<IProduct>('Product', ProductSchema, 'products');
