import mongoose, { Document } from "mongoose";

export interface ICartItem {
    product_id: mongoose.Types.ObjectId;
    variant_id?: mongoose.Types.ObjectId;
    quantity: number;
    is_selected: boolean;
    custom_notes?: string;
    custom_design_file?: string;
    updated_at: Date;
}

export interface ICart extends Document {
    user_id: mongoose.Types.ObjectId;
    items: ICartItem[];
    updated_at: Date;
}