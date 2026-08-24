import mongoose, { Schema, Document } from 'mongoose';

export interface IAddress {
    id?: mongoose.Types.ObjectId;
    recipient_name: string;
    phone: string;
    address_detail: string;
    province_id: string;
    district_id: string;
    ward_code: string;
    is_default: boolean;
}

export interface INotificationSettings {
    in_app: boolean;
    push: boolean;
    email: boolean;
}

export interface ICartItem {
    product_id: mongoose.Types.ObjectId;
    variant_id?: string;
    quantity: number;
    checked?: boolean;
}

export interface IUser extends Document {
    email: string;
    password_hash: string;
    role: 'BUYER' | 'SELLER' | 'ADMIN';
    is_locked: boolean;
    full_name: string;
    avatar?: string;
    phone?: string;
    identity_card_number?: string;
    tax_code?: string;
    addresses: IAddress[];
    notification_settings: INotificationSettings;
    wishlist: mongoose.Types.ObjectId[];
    cart: ICartItem[];
    created_at: Date;
    updated_at: Date;
}

const CartItemSchema = new Schema<ICartItem>({
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variant_id: { type: String },
    quantity: { type: Number, default: 1, min: 1 },
    checked: { type: Boolean, default: true }
}, { _id: false });

const AddressSchema = new Schema<IAddress>({
    recipient_name: { type: String, required: true },
    phone: { type: String, required: true },
    address_detail: { type: String, required: true },
    province_id: { type: String, required: true },
    district_id: { type: String, required: true },
    ward_code: { type: String, required: true },
    is_default: { type: Boolean, default: false }
}, {
    _id: true
});

const NotificationSettingsSchema = new Schema<INotificationSettings>({
    in_app: { type: Boolean, default: true },
    push: { type: Boolean, default: true },
    email: { type: Boolean, default: true }
}, { _id: false });

const UserSchema = new Schema<IUser>({
    email: { type: String, required: true, unique: true, index: true },
    password_hash: { type: String, required: true },
    role: {
        type: String,
        enum: ['BUYER', 'SELLER', 'ADMIN'],
        default: 'BUYER'
    },
    is_locked: { type: Boolean, default: false },
    full_name: { type: String, required: true },
    avatar: { type: String },
    phone: { type: String },
    identity_card_number: { type: String },
    tax_code: { type: String },
    addresses: { type: [AddressSchema], default: [] },
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: [] }],
    cart: { type: [CartItemSchema], default: [] },
    notification_settings: {
        type: NotificationSettingsSchema,
        default: () => ({})
    }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const User = mongoose.model<IUser>('User', UserSchema, 'users');
