import mongoose, { Schema, Document } from 'mongoose';

export interface IShippingAddress {
    recipient_name: string;
    phone: string;
    address_detail: string;
    province_id: string;
    district_id: string;
    ward_code: string;
}

export interface IShippingDetails {
    carrier?: string;
    tracking_number?: string;
    shipping_fee: mongoose.Types.Decimal128;
}

export interface IOrderItem {
    product_id: mongoose.Types.ObjectId;
    variant_id: mongoose.Types.ObjectId;
    title: string;
    color?: string;
    size?: string;
    quantity: number;
    base_cost: mongoose.Types.Decimal128;
    retail_price: mongoose.Types.Decimal128;
    image?: string;
    design_file_url?: string;
    custom_notes?: string;
}

export interface IFinancialBreakdown {
    subtotal: mongoose.Types.Decimal128;
    shipping_fee: mongoose.Types.Decimal128;
    coupon_discount: mongoose.Types.Decimal128;
    platform_fee: mongoose.Types.Decimal128;
    seller_payout_amount: mongoose.Types.Decimal128;
}

export interface IStatusHistory {
    status: 'ORDERED' | 'PENDING_DESIGN' | 'PROCESSING' | 'SHIPPING' | 'DELIVERED' | 'CANCELLED';
    changed_at: Date;
    note?: string;
}

export interface IOrder extends Document {
    buyer_id: mongoose.Types.ObjectId;
    shop_id: mongoose.Types.ObjectId;
    order_code: string;
    payment_method: 'VNPAY' | 'MOMO' | 'COD';
    payment_status: 'PENDING' | 'PAID' | 'REFUNDED';
    order_status: 'ORDERED' | 'PENDING_DESIGN' | 'PROCESSING' | 'SHIPPING' | 'DELIVERED' | 'CANCELLED';
    shipping_address: IShippingAddress;
    shipping_details: IShippingDetails;
    items: IOrderItem[];
    financial_breakdown: IFinancialBreakdown;
    status_history: IStatusHistory[];
    order_hour_of_week: number;
    created_at: Date;
    updated_at: Date;
}

const ShippingAddressSchema = new Schema<IShippingAddress>({
    recipient_name: { type: String, required: true },
    phone: { type: String, required: true },
    address_detail: { type: String, required: true },
    province_id: { type: String, required: true },
    district_id: { type: String, required: true },
    ward_code: { type: String, required: true }
}, { _id: false });

const ShippingDetailsSchema = new Schema<IShippingDetails>({
    carrier: { type: String },
    tracking_number: { type: String },
    shipping_fee: { type: Schema.Types.Decimal128, required: true, default: 0.0 }
}, { _id: false });

const OrderItemSchema = new Schema<IOrderItem>({
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variant_id: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true },
    title: { type: String, required: true },
    color: { type: String },
    size: { type: String },
    quantity: { type: Number, required: true, min: 1 },
    base_cost: { type: Schema.Types.Decimal128, required: true },
    retail_price: { type: Schema.Types.Decimal128, required: true },
    image: { type: String },
    design_file_url: { type: String },
    custom_notes: { type: String }
}, { _id: false });

const FinancialBreakdownSchema = new Schema<IFinancialBreakdown>({
    subtotal: { type: Schema.Types.Decimal128, required: true },
    shipping_fee: { type: Schema.Types.Decimal128, required: true },
    coupon_discount: { type: Schema.Types.Decimal128, required: true, default: 0.0 },
    platform_fee: { type: Schema.Types.Decimal128, required: true },
    seller_payout_amount: { type: Schema.Types.Decimal128, required: true }
}, { _id: false });

const StatusHistorySchema = new Schema<IStatusHistory>({
    status: {
        type: String,
        required: true,
        enum: ['ORDERED', 'PENDING_DESIGN', 'PROCESSING', 'SHIPPING', 'DELIVERED', 'CANCELLED']
    },
    changed_at: { type: Date, default: Date.now },
    note: { type: String }
}, { _id: false });

const OrderSchema = new Schema<IOrder>({
    buyer_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    order_code: { type: String, required: true, unique: true, index: true },
    payment_method: { type: String, required: true, enum: ['VNPAY', 'MOMO', 'COD'] },
    payment_status: { type: String, required: true, enum: ['PENDING', 'PAID', 'REFUNDED'], default: 'PENDING' },
    order_status: {
        type: String,
        required: true,
        enum: ['ORDERED', 'PENDING_DESIGN', 'PROCESSING', 'SHIPPING', 'DELIVERED', 'CANCELLED'],
        default: 'ORDERED'
    },
    shipping_address: { type: ShippingAddressSchema, required: true },
    shipping_details: { type: ShippingDetailsSchema, required: true },
    items: { type: [OrderItemSchema], required: true },
    financial_breakdown: { type: FinancialBreakdownSchema, required: true },
    status_history: { type: [StatusHistorySchema], default: [] },
    order_hour_of_week: { type: Number, required: true, index: true }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const Order = mongoose.model<IOrder>('Order', OrderSchema, 'orders');
