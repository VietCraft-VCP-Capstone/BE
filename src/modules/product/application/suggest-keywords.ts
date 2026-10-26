import mongoose from 'mongoose';
import { SearchLog } from '../../analytics/infrastructure/models/search-log.model';
import { accentInsensitive, hasTone, nfcLower, normalizeVi } from '../../../shared/utils/vietnamese-search.util';

const MAX_LEN = 40;
const MIN_USERS = 2;
const POPULAR_DAYS = 90;

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
    // Gõ liền ("aothun") không khớp từng từ: thử nối nhiều từ liên tiếp của tiêu đề
    if (qWords.length === 1 && qWords[0].length >= 3) {
        for (let i = 0; i < norms.length; i++) {
            let joined = '';
            for (let j = i; j < norms.length && j < i + 4; j++) {
                joined += norms[j];
                if (joined.startsWith(qWords[0])) return words.slice(i, j + 2).join(' ');
            }
        }
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
export async function fetchLoggedKeywords(q: string, userId: string, limit = 4): Promise<string[]> {
    const rows = await SearchLog.aggregate([
        {
            $match: {
                user_id: new mongoose.Types.ObjectId(userId),
                keyword: { $regex: '^' + accentInsensitive(q), $options: 'i', $ne: q },
                result_count: { $gt: 0 },
            },
        },
        { $group: { _id: { $toLower: '$keyword' }, keyword: { $max: '$keyword' }, last: { $max: '$created_at' } } },
        { $sort: { last: -1 } },
        { $limit: limit },
    ]);
    return rows.map((r: any) => r.keyword);
}

/** Từ khoá được ít nhất MIN_USERS người dùng khác nhau tìm có kết quả trong 90 ngày, phổ biến nhất trước. */
export async function fetchPopularKeywords(q: string, limit = 4): Promise<string[]> {
    const since = new Date(Date.now() - POPULAR_DAYS * 24 * 60 * 60 * 1000);
    const rows = await SearchLog.aggregate([
        {
            $match: {
                keyword: { $regex: '^' + accentInsensitive(q), $options: 'i' },
                result_count: { $gt: 0 },
                user_id: { $exists: true, $ne: null },
                created_at: { $gte: since },
            },
        },
        {
            $group: {
                _id: { $toLower: '$keyword' },
                keyword: { $max: '$keyword' },
                users: { $addToSet: '$user_id' },
                clicks: { $sum: { $size: { $ifNull: ['$clicks', []] } } },
            },
        },
        {
            $addFields: {
                userCount: { $size: '$users' },
                score: { $add: [{ $size: '$users' }, { $multiply: ['$clicks', 2] }] },
            },
        },
        { $match: { userCount: { $gte: MIN_USERS } } },
        { $sort: { score: -1 } },
        { $limit: limit },
    ]);
    return rows.map((r: any) => r.keyword);
}
