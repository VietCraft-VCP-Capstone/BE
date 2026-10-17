import mongoose from 'mongoose';
import { SearchLog } from '../../analytics/infrastructure/models/search-log.model';
import { escapeRegex, hasTone, nfcLower, normalizeVi } from '../../../shared/utils/vietnamese-search.util';

const MAX_LEN = 40;

/** Cụm từ trong tiêu đề bắt đầu tại chỗ khớp, thêm 1 từ phía sau để gợi ý cụ thể hơn. */
export function phraseFromTitle(title: string, qWords: string[]): string | null {
    if (qWords.length === 0) return null;
    const words = nfcLower(title).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const norms = words.map(normalizeVi);
    const last = qWords.length - 1;
    for (let i = 0; i + last < norms.length; i++) {
        const hit = qWords.every((w, j) => (j < last ? norms[i + j] === w : norms[i + j].startsWith(w)));
        if (hit) return words.slice(i, i + qWords.length + 1).join(' ');
    }
    return null;
}

export function buildKeywordSuggestions(q: string, logged: string[], titles: string[], banned: string[], limit = 6): string[] {
    const qNorm = normalizeVi(q);
    const qWords = qNorm.split(' ').filter(Boolean);
    const bannedNorms = banned.map(normalizeVi).filter(Boolean);

    const counts = new Map<string, number>();
    for (const t of titles) {
        const p = phraseFromTitle(t, qWords);
        if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    const fromTitles = [...counts].sort((a, b) => b[1] - a[1]).map(([p]) => p);

    const picked = new Map<string, string>();
    for (const raw of [...logged, ...fromTitles]) {
        const kw = nfcLower(raw).replace(/\s+/g, ' ');
        const norm = normalizeVi(kw);
        if (!norm || norm === qNorm || kw.length > MAX_LEN || bannedNorms.some(b => norm.includes(b))) continue;
        const prev = picked.get(norm);
        if (prev === undefined || (!hasTone(prev) && hasTone(kw))) picked.set(norm, kw);
    }
    return [...picked.values()].slice(0, limit);
}

/** Từ khoá chính người dùng này đã tìm (có kết quả), bắt đầu bằng chuỗi đang gõ, mới nhất trước. */
export async function fetchLoggedKeywords(norm: string, userId: string, limit = 4): Promise<string[]> {
    const rows = await SearchLog.aggregate([
        {
            $match: {
                user_id: new mongoose.Types.ObjectId(userId),
                keyword_norm: { $regex: '^' + escapeRegex(norm), $ne: norm },
                result_count: { $gt: 0 },
            },
        },
        { $group: { _id: '$keyword_norm', keyword: { $max: '$keyword' }, last: { $max: '$created_at' } } },
        { $sort: { last: -1 } },
        { $limit: limit },
    ]);
    return rows.map((r: any) => r.keyword);
}
