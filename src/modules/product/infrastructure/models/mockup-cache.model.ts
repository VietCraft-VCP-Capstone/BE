import mongoose, { Schema } from 'mongoose';

/** Mask phôi do AI tách, lưu theo ảnh phôi để mỗi ảnh chỉ chạy AI một lần. */
export interface IBlankMask {
    key: string;          // sha1(image_url)
    image_url: string;
    mask_png: Buffer;     // PNG xám, cùng kích thước ảnh gốc
    model?: string;
    coverage?: number;
}

const BlankMaskSchema = new Schema<IBlankMask>({
    key: { type: String, required: true, unique: true },
    image_url: { type: String, required: true },
    mask_png: { type: Buffer, required: true },
    model: { type: String },
    coverage: { type: Number },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export const BlankMask = mongoose.model<IBlankMask>('BlankMask', BlankMaskSchema, 'blank_masks');

/** Ảnh mockup đã render, theo khoá nội dung (ảnh phôi + mask + màu + thiết kế). Hết hạn sau 30 ngày. */
export interface IMockupRender {
    key: string;
    url: string;
    source: string;
    created_at?: Date;
}

const MockupRenderSchema = new Schema<IMockupRender>({
    key: { type: String, required: true, unique: true },
    url: { type: String, required: true },
    source: { type: String, required: true },
    created_at: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
});

export const MockupRender = mongoose.model<IMockupRender>('MockupRender', MockupRenderSchema, 'mockup_renders');
