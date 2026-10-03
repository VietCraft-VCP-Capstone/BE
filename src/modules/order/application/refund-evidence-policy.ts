const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov']);

function extensionOf(value: string): string {
    const clean = value.split(/[?#]/, 1)[0].toLowerCase();
    return clean.slice(clean.lastIndexOf('.') + 1);
}

function isSupportedRefundEvidenceUrl(value: string): boolean {
    const extension = extensionOf(value);
    if (![...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].includes(extension)) return false;
    const refundUploadPath = /^\/uploads\/refunds\/[a-z0-9-]+\.(jpg|jpeg|png|webp|mp4|webm|mov)$/i;
    if (refundUploadPath.test(value)) return true;
    try {
        const url = new URL(value);
        const localUpload = (url.protocol === 'http:' || url.protocol === 'https:') && refundUploadPath.test(url.pathname);
        const cloudinaryEvidence = url.protocol === 'https:' && url.hostname === 'res.cloudinary.com'
            && /\/image\/upload\//i.test(url.pathname)
            && /\/refunds\/[a-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(url.pathname);
        return localUpload || cloudinaryEvidence;
    } catch { return false; }
}

export function isValidRefundImageBuffer(buffer: Buffer): boolean {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
    return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
}

function readUInt32LE(buffer: Buffer, offset: number): number {
    return buffer.readUInt32LE(offset);
}

export function isValidRefundVideoBuffer(buffer: Buffer): boolean {
    if (buffer.length >= 8 && buffer.toString('ascii', 4, 8) === 'ftyp') return true;
    if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return true;
    return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF'
        && buffer.toString('ascii', 8, 12) === 'AVI ' && readUInt32LE(buffer, 4) < buffer.length;
}

export function validateRefundEvidence(
    reasonCategory: unknown,
    description: unknown,
    evidence: unknown,
    options: { allowEmptyEvidenceForTest?: boolean } = {},
): string[] {
    if (typeof reasonCategory !== 'string' || !reasonCategory.trim()) {
        throw new Error('Vui lòng chọn lý do yêu cầu hoàn tiền.');
    }
    if (typeof description !== 'string' || !description.trim()) {
        throw new Error('Vui lòng mô tả lý do hoàn tiền.');
    }
    if (description.trim().length < 5) throw new Error('Mô tả cần ít nhất 5 ký tự.');
    if (!Array.isArray(evidence) || evidence.some(url => typeof url !== 'string' || !isSupportedRefundEvidenceUrl(url))) {
        throw new Error('Minh chứng phải là ảnh JPG, PNG, WebP hoặc video MP4, WebM, MOV đã tải lên.');
    }

    const urls = evidence as string[];
    const imageCount = urls.filter(url => IMAGE_EXTENSIONS.has(extensionOf(url))).length;
    const videoCount = urls.filter(url => VIDEO_EXTENSIONS.has(extensionOf(url))).length;
    if (imageCount > 3) throw new Error('Mỗi yêu cầu được đính kèm tối đa 3 ảnh.');
    if (videoCount > 1) throw new Error('Mỗi yêu cầu được đính kèm tối đa 1 video.');
    if (!options.allowEmptyEvidenceForTest && urls.length === 0) throw new Error('Vui lòng đính kèm ít nhất 1 ảnh hoặc video minh chứng.');
    return urls;
}
