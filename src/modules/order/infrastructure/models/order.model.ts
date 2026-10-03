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
    provider_sku?: string;
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

export interface IPrinterOrderInfo {
    printer_id?: string;
    printer_name?: string;
    supplier_order_id?: string;
    dispatched_at?: Date;
    printer_status?: string;
    rejection_reason?: string;
}

export interface IOrder extends Document {
    buyer_id: mongoose.Types.ObjectId;
    shop_id: mongoose.Types.ObjectId;
    order_code: string;
    simulation_source_id?: mongoose.Types.ObjectId;
    is_simulated?: boolean;
    payment_method: 'VNPAY' | 'MOMO' | 'COD';
    payment_status: 'PENDING' | 'PAID' | 'REFUNDED';
    refund_status: 'NONE' | 'REQUESTED' | 'UNDER_REVIEW' | 'DISPUTED' | 'REFUNDED' | 'REFUND_REJECTED';
    order_status: 'ORDERED' | 'PENDING_DESIGN' | 'PROCESSING' | 'SHIPPING' | 'DELIVERED' | 'CANCELLED';
    seller_approval_status?: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
    is_pod?: boolean;
    order_type?: 'POD' | 'READY_TO_SHIP' | 'STANDARD';
    shipping_address: IShippingAddress;
    shipping_details: IShippingDetails;
    supplier_order_id?: string;
    fulfillment_status?: 'UNFULFILLED' | 'PENDING_APPROVAL' | 'QUEUED' | 'SUBMITTED' | 'RECEIVED' | 'PRINTING' | 'PACKAGED' | 'SHIPPED' | 'DELIVERED' | 'FAILED' | 'CANCELLED';
    printer_info?: IPrinterOrderInfo;
    items: IOrderItem[];
    financial_breakdown: IFinancialBreakdown;
    coupon_code?: string;
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
    custom_notes: { type: String },
    provider_sku: { type: String, trim: true }
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
    simulation_source_id: { type: Schema.Types.ObjectId, ref: 'Order', index: true },
    is_simulated: { type: Boolean, default: false, index: true },
    payment_method: { type: String, required: true, enum: ['VNPAY', 'MOMO', 'COD'] },
    payment_status: { type: String, required: true, enum: ['PENDING', 'PAID', 'REFUNDED'], default: 'PENDING' },
    refund_status: { type: String, required: true, enum: ['NONE', 'REQUESTED', 'UNDER_REVIEW', 'DISPUTED', 'REFUNDED', 'REFUND_REJECTED'], default: 'NONE', index: true },
    order_status: {
        type: String,
        required: true,
        enum: ['ORDERED', 'PENDING_DESIGN', 'PROCESSING', 'SHIPPING', 'DELIVERED', 'CANCELLED'],
        default: 'ORDERED'
    },
    seller_approval_status: {
        type: String,
        enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
        default: 'PENDING_APPROVAL',
        index: true
    },
    is_pod: { type: Boolean, default: false, index: true },
    order_type: { type: String, enum: ['POD', 'READY_TO_SHIP', 'STANDARD'], default: 'STANDARD', index: true },
    shipping_address: { type: ShippingAddressSchema, required: true },
    shipping_details: { type: ShippingDetailsSchema, required: true },
    supplier_order_id: { type: String, index: true },
    fulfillment_status: {
        type: String,
        enum: ['UNFULFILLED', 'PENDING_APPROVAL', 'QUEUED', 'SUBMITTED', 'RECEIVED', 'PRINTING', 'PACKAGED', 'SHIPPED', 'DELIVERED', 'FAILED', 'CANCELLED'],
        default: 'UNFULFILLED',
        index: true
    },
    printer_info: { type: Schema.Types.Mixed, default: {} },
    items: { type: [OrderItemSchema], required: true },
    financial_breakdown: { type: FinancialBreakdownSchema, required: true },
    coupon_code: { type: String, default: null, index: true },
    status_history: { type: [StatusHistorySchema], default: [] },
    order_hour_of_week: { type: Number, required: true, index: true }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

OrderSchema.index({ simulation_source_id: 1, buyer_id: 1 }, { unique: true, partialFilterExpression: { is_simulated: true } });
OrderSchema.index({ buyer_id: 1, created_at: -1 });
OrderSchema.index({ shop_id: 1, created_at: -1 });

export const Order = mongoose.model<IOrder>('Order', OrderSchema, 'orders');
