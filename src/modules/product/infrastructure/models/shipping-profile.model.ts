import mongoose, { Schema, Document } from 'mongoose';

export interface IShippingCost {
    destination_province_id: string; // Province index/ID from GHN/GHTK
    base_cost: mongoose.Types.Decimal128;
    item_increment_cost: mongoose.Types.Decimal128;
}

export interface IProcessingDays {
    min: number;
    max: number;
}

export interface IShippingProfile extends Document {
    shop_id: mongoose.Types.ObjectId;
    profile_name: string;
    carrier: 'GHN' | 'GHTK';
    processing_days: IProcessingDays;
    shipping_costs: IShippingCost[];
}

const ShippingCostSchema = new Schema<IShippingCost>({
    destination_province_id: { type: String, required: true },
    base_cost: { type: Schema.Types.Decimal128, required: true },
    item_increment_cost: { type: Schema.Types.Decimal128, required: true }
}, { _id: false });

const ProcessingDaysSchema = new Schema<IProcessingDays>({
    min: { type: Number, required: true, min: 0 },
    max: { type: Number, required: true, min: 0 }
}, { _id: false });

const ShippingProfileSchema = new Schema<IShippingProfile>({
    shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    profile_name: { type: String, required: true },
    carrier: { type: String, enum: ['GHN', 'GHTK'], required: true },
    processing_days: { type: ProcessingDaysSchema, required: true },
    shipping_costs: { type: [ShippingCostSchema], default: [] }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const ShippingProfile = mongoose.model<IShippingProfile>('ShippingProfile', ShippingProfileSchema, 'shipping_profiles');
