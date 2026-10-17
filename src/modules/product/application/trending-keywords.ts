import mongoose from 'mongoose';
import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';

const POOL = 20;
const LIVE_TTL_MS = 30 * 60 * 1000;
const FALLBACK_TTL_MS = 60 * 1000;
const FALLBACK_KEYWORDS = [
    'Quà Tặng', 'Áo Đồng Phục', 'Áo Thun', 'Quà Sinh Nhật',
    'Móc Khóa', 'Áo Lớp', 'Túi Tote', 'Áo Anime',
];

let cache: { keywords: string[]; expiresAt: number } | null = null;

/** Cache cả nhóm POOL từ khóa rồi cắt theo limit, nên các limit khác nhau dùng chung một lần lấy dữ liệu. */
export async function getTrendingKeywords(limit = 8): Promise<string[]> {
    const now = Date.now();
    if (cache && cache.expiresAt > now) {
        return cache.keywords.slice(0, limit);
    }

    let keywords = await fetchFromAi();
    if (keywords.length === 0) {
        keywords = await fetchFromTrendCollections();
    }

    const isLive = keywords.length > 0;
    const formatted = Array.from(new Set((isLive ? keywords : FALLBACK_KEYWORDS).map(formatKw).filter(Boolean))).slice(0, POOL);
    cache = { keywords: formatted, expiresAt: now + (isLive ? LIVE_TTL_MS : FALLBACK_TTL_MS) };

    return formatted.slice(0, limit);
}

async function fetchFromAi(): Promise<string[]> {
    if (!config.aiAnalyticsUrl) return [];
    try {
        const res = await fetch(`${config.aiAnalyticsUrl}/api/analytics/forecast/niches`, {
            headers: {
                Accept: 'application/json',
                'X-Gateway-Secret': config.aiGatewaySecret || '',
                'X-Shop-Id': 'demo',
            },
            signal: AbortSignal.timeout(1200),
        });
        if (!res.ok) return [];
        const json: any = await res.json();
        const niches = json?.data?.niches || json?.niches || [];
        return Array.isArray(niches) ? niches.slice(0, POOL).map((n: any) => n.keyword).filter(Boolean) : [];
    } catch {
        return []; // AI offline hoặc timeout
    }
}

async function fetchFromTrendCollections(): Promise<string[]> {
    const db = mongoose.connection.db;
    if (mongoose.connection.readyState !== 1 || !db) return [];
    try {
        const colNames = (await db.listCollections().toArray()).map(c => c.name);

        if (colNames.includes('trend_interest')) {
            const agg = await db.collection('trend_interest').aggregate([
                { $sort: { observed_on: -1 } },
                { $limit: 1000 },
                { $group: { _id: '$keyword', avgScaled: { $avg: '$scaled' } } },
                { $sort: { avgScaled: -1 } },
                { $limit: POOL },
            ]).toArray();
            const keywords = agg.map((r: any) => r._id).filter(Boolean);
            if (keywords.length > 0) return keywords;
        }

        if (colNames.includes('trend_keyword')) {
            const docs = await db.collection('trend_keyword').find({ active: true }).limit(POOL).toArray();
            return docs.map((d: any) => d.keyword).filter(Boolean);
        }
        return [];
    } catch (err: any) {
        logger.warn(`Lỗi khi lấy trending keywords từ AI Analyst: ${err?.message}`);
        return [];
    }
}

function formatKw(k: string): string {
    return k.trim().split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
