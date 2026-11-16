import mongoose from 'mongoose';
import { RecentSearch } from '../infrastructure/models/recent-search.model';

export const RECENT_MAX = 8;

function validId(userId: string): boolean {
    return mongoose.Types.ObjectId.isValid(userId);
}

export async function getRecentSearches(userId: string): Promise<string[]> {
    if (!validId(userId)) return [];
    const doc = await RecentSearch.findOne({ user_id: userId }).select('keywords');
    return doc?.keywords ?? [];
}

// shortcut: đọc-rồi-ghi, 2 tab gõ cùng lúc có thể mất 1 từ; đủ cho lịch sử tìm kiếm
export async function addRecentSearch(userId: string, keyword: string): Promise<string[]> {
    if (!validId(userId)) return [];
    const kw = keyword.trim().slice(0, 100);
    const current = await getRecentSearches(userId);
    if (!kw) return current;
    const keywords = [kw, ...current.filter(s => s.toLowerCase() !== kw.toLowerCase())].slice(0, RECENT_MAX);
    await RecentSearch.updateOne({ user_id: userId }, { $set: { keywords } }, { upsert: true });
    return keywords;
}

export async function clearRecentSearches(userId: string): Promise<void> {
    if (!validId(userId)) return;
    await RecentSearch.updateOne({ user_id: userId }, { $set: { keywords: [] } });
}
