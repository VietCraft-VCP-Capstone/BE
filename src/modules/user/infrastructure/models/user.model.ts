import mongoose, { Schema } from 'mongoose';
import { IAddress, INotificationSettings, IUser } from '../../types';


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
    is_phone_verified: { type: Boolean, default: false },
    is_email_verified: { type: Boolean, default: true },
    seller_status: {
        type: String,
        enum: ['NONE', 'PENDING', 'APPROVED', 'REJECTED'],
        default: 'NONE'
    },
    seller_application_id: { type: Schema.Types.ObjectId, ref: 'SellerApplication' },
    identity_card_number: { type: String },
    tax_code: { type: String },
    addresses: { type: [AddressSchema], default: [] },
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: [] }],
    notification_settings: {
        type: NotificationSettingsSchema,
        default: () => ({})
    }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const User = mongoose.model<IUser>('User', UserSchema, 'users');

