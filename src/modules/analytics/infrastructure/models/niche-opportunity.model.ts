import mongoose, { Schema, Document } from 'mongoose';

export interface INicheOpportunity extends Document {
    tag: string;
    category_id: string;
    search_growth_rate: number;
    competition_density: number;
    gap_score: number;
    momentum_score: number;
    updated_at: Date;
}

const NicheOpportunitySchema = new Schema<INicheOpportunity>({
    tag: { type: String, required: true, unique: true, index: true },
    category_id: { type: String, required: true, index: true },
    search_growth_rate: { type: Number, required: true, default: 0.0 },
    competition_density: { type: Number, required: true, default: 0.0 },
    gap_score: { type: Number, required: true, default: 0.0 },
    momentum_score: { type: Number, required: true, default: 0.0 }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const NicheOpportunity = mongoose.model<INicheOpportunity>('NicheOpportunity', NicheOpportunitySchema, 'niche_opportunities');
