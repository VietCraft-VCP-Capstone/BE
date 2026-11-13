import mongoose, { Schema, Document } from 'mongoose';

/**
 * Kết quả quét OCR CCCD gần nhất cho từng file ảnh, dùng để đối chiếu khi seller nộp hồ sơ.
 * Dữ liệu cá nhân (số CCCD, họ tên, ngày sinh...) chỉ nằm trong `data_encrypted` (AES-256-GCM
 * qua encryptField). Tự xoá sau OCR_SCAN_TTL_DAYS ngày (TTL index) — sau khi nộp hồ sơ, hồ sơ
 * chỉ giữ kết quả đối chiếu (ocr_check), không giữ giá trị OCR.
 */
export const OCR_SCAN_TTL_DAYS = 7;

export interface IKycOcrScan extends Document {
    user_id: mongoose.Types.ObjectId;
    filename: string;
    side: 'front' | 'back';
    data_encrypted: string;
    is_valid: boolean;
    confidence_score: number;
    created_at: Date;
    updated_at: Date;
}

const KycOcrScanSchema = new Schema<IKycOcrScan>({
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    filename: { type: String, required: true },
    side: { type: String, enum: ['front', 'back'], required: true },
    data_encrypted: { type: String, required: true },
    is_valid: { type: Boolean, default: false },
    confidence_score: { type: Number, default: 0 },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

KycOcrScanSchema.index({ user_id: 1, filename: 1, side: 1 }, { unique: true });
KycOcrScanSchema.index({ updated_at: 1 }, { expireAfterSeconds: OCR_SCAN_TTL_DAYS * 24 * 3600 });

export const KycOcrScan = mongoose.model<IKycOcrScan>('KycOcrScan', KycOcrScanSchema, 'kyc_ocr_scans');
