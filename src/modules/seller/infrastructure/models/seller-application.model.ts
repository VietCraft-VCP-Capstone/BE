import mongoose, { Schema, Document } from 'mongoose';

export type SellerType = 'INDIVIDUAL' | 'BUSINESS';
export type SellerApplicationStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export interface IKycData {
    full_name: string;
    identity_card_number_encrypted: string;
    date_of_birth?: string;
    id_issue_date?: string;
    id_issue_place?: string;
    tax_code?: string;
    front_id_image?: string;
    back_id_image?: string;

    company_name?: string;
    business_license_number_encrypted?: string;
    business_license_image?: string;
    legal_rep_name?: string;
    legal_rep_position?: string;
    legal_rep_id?: string;
}

export interface IPickupAddress {
    recipient_name: string;
    phone: string;
    province_id: string;
    district_id: string;
    ward_code: string;
    address_detail: string;
}

export interface IShopInfo {
    shop_name: string;
    shop_slug: string;
    description?: string;
    main_category?: string;
    pickup_address: IPickupAddress;
}

export interface ISellerBankInfo {
    bank_code: string;
    bank_name: string;
    account_number_encrypted: string;
    account_holder: string;
    is_name_matched: boolean;
}

export interface ICompliance {
    agreed_terms: boolean;
    agreed_pdpd_policy: boolean;
    electronic_signature: string;
    signed_at: Date;
    ip_address?: string;
}

export interface IAuditEntry {
    action: string;
    actor_id?: mongoose.Types.ObjectId;
    timestamp: Date;
    note?: string;
}

export interface ISellerApplication extends Document {
    user_id: mongoose.Types.ObjectId;
    seller_type: SellerType;
    status: SellerApplicationStatus;
    phone: string;
    is_phone_verified: boolean;
    email: string;
    is_email_verified: boolean;
    kyc_data: IKycData;
    shop_info: IShopInfo;
    bank_info: ISellerBankInfo;
    compliance: ICompliance;
    review?: {
        reviewed_by?: mongoose.Types.ObjectId;
        reviewed_at?: Date;
        rejection_reason?: string;
    };
    audit_trail: IAuditEntry[];
    created_at: Date;
    updated_at: Date;
}

const PickupAddressSchema = new Schema<IPickupAddress>({
    recipient_name: { type: String, required: true },
    phone: { type: String, required: true },
    province_id: { type: String, required: true },
    district_id: { type: String, required: true },
    ward_code: { type: String, default: '' },
    address_detail: { type: String, required: true },
}, { _id: false });

const KycDataSchema = new Schema<IKycData>({
    full_name: { type: String, required: true },
    identity_card_number_encrypted: { type: String, required: true },
    date_of_birth: { type: String },
    id_issue_date: { type: String },
    id_issue_place: { type: String },
    tax_code: { type: String },
    front_id_image: { type: String },
    back_id_image: { type: String },

    company_name: { type: String },
    business_license_number_encrypted: { type: String },
    business_license_image: { type: String },
    legal_rep_name: { type: String },
    legal_rep_position: { type: String },
    legal_rep_id: { type: String },
}, { _id: false });

const ShopInfoSchema = new Schema<IShopInfo>({
    shop_name: { type: String, required: true },
    shop_slug: { type: String, required: true },
    description: { type: String },
    main_category: { type: String },
    pickup_address: { type: PickupAddressSchema, required: true },
}, { _id: false });

const SellerBankInfoSchema = new Schema<ISellerBankInfo>({
    bank_code: { type: String, required: true },
    bank_name: { type: String, required: true },
    account_number_encrypted: { type: String, required: true },
    account_holder: { type: String, required: true },
    is_name_matched: { type: Boolean, default: true },
}, { _id: false });

const ComplianceSchema = new Schema<ICompliance>({
    agreed_terms: { type: Boolean, required: true },
    agreed_pdpd_policy: { type: Boolean, required: true },
    electronic_signature: { type: String, required: true },
    signed_at: { type: Date, default: Date.now },
    ip_address: { type: String },
}, { _id: false });

const AuditEntrySchema = new Schema<IAuditEntry>({
    action: { type: String, required: true },
    actor_id: { type: Schema.Types.ObjectId, ref: 'User' },
    timestamp: { type: Date, default: Date.now },
    note: { type: String },
}, { _id: false });

const SellerApplicationSchema = new Schema<ISellerApplication>({
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    seller_type: {
        type: String,
        enum: ['INDIVIDUAL', 'BUSINESS'],
        required: true,
        default: 'INDIVIDUAL'
    },
    status: {
        type: String,
        enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
        default: 'DRAFT',
        index: true
    },
    phone: { type: String, required: true },
    is_phone_verified: { type: Boolean, default: false },
    email: { type: String, required: true },
    is_email_verified: { type: Boolean, default: true },
    kyc_data: { type: KycDataSchema, required: true },
    shop_info: { type: ShopInfoSchema, required: true },
    bank_info: { type: SellerBankInfoSchema, required: true },
    compliance: { type: ComplianceSchema, required: true },
    review: {
        reviewed_by: { type: Schema.Types.ObjectId, ref: 'User' },
        reviewed_at: { type: Date },
        rejection_reason: { type: String },
    },
    audit_trail: { type: [AuditEntrySchema], default: [] },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

SellerApplicationSchema.index({ user_id: 1, status: 1 });

export const SellerApplication = mongoose.model<ISellerApplication>(
    'SellerApplication',
    SellerApplicationSchema,
    'seller_applications'
);
