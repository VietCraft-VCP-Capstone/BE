import mongoose, { Document } from "mongoose";

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

export interface IUser extends Document {
    email: string;
    password_hash: string;
    role: 'BUYER' | 'SELLER' | 'ADMIN';
    is_locked: boolean;
    full_name: string;
    avatar?: string;
    phone?: string;
    is_phone_verified?: boolean;
    is_email_verified?: boolean;
    seller_status?: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
    seller_application_id?: mongoose.Types.ObjectId;
    identity_card_number?: string;
    tax_code?: string;
    addresses: IAddress[];
    notification_settings: INotificationSettings;
    wishlist: mongoose.Types.ObjectId[];
    created_at: Date;
    updated_at: Date;
}
