const podEvidenceReasonCodes = new Set(['R01', 'R01A', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R13', 'R99']);

export interface ReturnEvidenceItem {
    id: string;
    kind: 'IMAGE' | 'VIDEO';
    uri: string;
}

export type ReturnEvidenceValidation =
    | { kind: 'VALID'; normalizedReason: string; normalizedDescription: string; imageCount: number; videoCount: number }
    | { kind: 'INVALID'; reason: string };

export function validateReturnEvidence(input: {
    reasonCode: string;
    description: string;
    evidence: readonly ReturnEvidenceItem[];
}): ReturnEvidenceValidation {
    const normalizedReason = input.reasonCode.trim().toUpperCase();
    const normalizedDescription = input.description.trim();
    if (!normalizedReason) return { kind: 'INVALID', reason: 'Cần chọn lý do yêu cầu.' };
    if (!podEvidenceReasonCodes.has(normalizedReason)) return { kind: 'INVALID', reason: 'Lý do không được hỗ trợ cho POD.' };
    if (!normalizedDescription) return { kind: 'INVALID', reason: 'Cần nhập mô tả chi tiết.' };
    if (!Array.isArray(input.evidence) || input.evidence.length === 0) return { kind: 'INVALID', reason: 'Cần ít nhất một ảnh hoặc video làm minh chứng.' };

    const ids = new Set<string>();
    let imageCount = 0;
    let videoCount = 0;
    for (const item of input.evidence) {
        if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) {
            return { kind: 'INVALID', reason: 'Mỗi minh chứng phải có ID hợp lệ và duy nhất.' };
        }
        ids.add(item.id);
        if (typeof item.uri !== 'string' || !item.uri.trim()) return { kind: 'INVALID', reason: 'Minh chứng phải tham chiếu tệp đã tải lên hợp lệ.' };
        if (item.kind === 'IMAGE') imageCount += 1;
        else if (item.kind === 'VIDEO') videoCount += 1;
        else return { kind: 'INVALID', reason: 'Chỉ hỗ trợ minh chứng dạng ảnh hoặc video.' };
    }
    if (imageCount > 3) return { kind: 'INVALID', reason: 'Tối đa 3 ảnh minh chứng.' };
    if (videoCount > 1) return { kind: 'INVALID', reason: 'Tối đa 1 video minh chứng.' };
    return { kind: 'VALID', normalizedReason, normalizedDescription, imageCount, videoCount };
}
