import type { IOcrCheck, OcrCheckStatus } from '../infrastructure/models/seller-application.model';

/** Phần kết quả OCR được lưu (đã mã hoá) để đối chiếu khi nộp hồ sơ. */
export interface OcrFrontSummary {
    id_number?: string | null;
    full_name?: string | null;
    date_of_birth?: string | null;
    gender?: string | null;
}

export interface OcrBackSummary {
    issue_date?: string | null;
    mrz_full_id?: string | null;
    mrz_valid?: boolean;
}

export interface OcrScanRecord<T> {
    summary: T;
    is_valid: boolean;
    confidence_score: number;
}

export interface SubmittedIdentity {
    id_number: string;
    full_name: string;
    date_of_birth?: string;
}

const digitsOnly = (v?: string | null) => String(v || '').replace(/\D/g, '');

/** Chuẩn hoá ngày về DD/MM/YYYY (nhận DD/MM/YYYY, D-M-YYYY, YYYY-MM-DD). */
export function normalizeDate(v?: string | null): string | null {
    const s = String(v || '').trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return `${m[3].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[1]}`;
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
    return null;
}

/**
 * So thông tin seller nộp với kết quả quét. Chỉ so những trường OCR đọc được;
 * trường OCR không đọc được thì bỏ qua (không coi là lệch).
 */
export function compareOcrWithSubmission(
    front: OcrScanRecord<OcrFrontSummary> | null,
    back: OcrScanRecord<OcrBackSummary> | null,
    submitted: SubmittedIdentity,
    namesMatch: (a: string, b: string) => boolean,
): IOcrCheck {
    const mismatches: string[] = [];
    const submittedId = digitsOnly(submitted.id_number);

    if (front) {
        const ocrId = digitsOnly(front.summary.id_number);
        if (ocrId && ocrId !== submittedId) mismatches.push('id_number');
        if (front.summary.full_name && !namesMatch(front.summary.full_name, submitted.full_name)) {
            mismatches.push('full_name');
        }
        const ocrDob = normalizeDate(front.summary.date_of_birth);
        const subDob = normalizeDate(submitted.date_of_birth);
        if (ocrDob && subDob && ocrDob !== subDob) mismatches.push('date_of_birth');
    }
    if (back?.summary.mrz_valid && back.summary.mrz_full_id && digitsOnly(back.summary.mrz_full_id) !== submittedId) {
        mismatches.push('mrz_id_number');
    }

    let status: OcrCheckStatus;
    if (!front) status = 'NOT_SCANNED';
    else if (mismatches.length) status = 'MISMATCH';
    else if (!front.is_valid) status = 'LOW_QUALITY';
    else status = 'MATCH';

    return {
        status,
        mismatches,
        front_valid: front?.is_valid,
        front_confidence: front?.confidence_score,
        back_valid: back?.is_valid,
        back_confidence: back?.confidence_score,
        checked_at: new Date(),
    };
}

/** Rút gọn response OCR thành phần cần lưu để đối chiếu. */
export function summarizeOcrResult(side: 'front' | 'back', data: any): OcrFrontSummary | OcrBackSummary {
    const o = data?.ocr_data || {};
    if (side === 'front') {
        return {
            id_number: o.id_number ?? null,
            full_name: o.full_name ?? null,
            date_of_birth: o.date_of_birth ?? null,
            gender: o.gender ?? null,
        };
    }
    return {
        issue_date: o.issue_date ?? null,
        mrz_full_id: o.mrz?.full_id ?? null,
        mrz_valid: Boolean(o.mrz?.is_valid && o.mrz?.full_id_consistent),
    };
}

export const OCR_MISMATCH_LABELS: Record<string, string> = {
    id_number: 'Số CCCD',
    full_name: 'Họ tên',
    date_of_birth: 'Ngày sinh',
    mrz_id_number: 'Số CCCD trên dải MRZ mặt sau',
};
