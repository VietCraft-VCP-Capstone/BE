import mongoose from 'mongoose';
import { BannedKeyword } from '../../analytics/infrastructure/models/banned-keyword.model';
import { PageParams, Paginated, clampPage, paginate } from '../../../shared/utils/pagination';
import { BUILTIN_SYSTEM_KEYWORDS } from '../../../shared/services/content-moderation.service';

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class BannedKeywordsService {
    async list(
        search?: string,
        params?: PageParams,
        scope: 'all' | 'custom' | 'system' = 'all'
    ): Promise<Paginated<any>> {
        const q = String(search || '').trim().toLowerCase();
        const defaultParams: PageParams = params || { page: 1, limit: 20, skip: 0 };

        // 1. Chỉ lấy từ khóa do Admin thêm
        if (scope === 'custom') {
            const query: Record<string, any> = {};
            if (q) {
                const rx = new RegExp(escapeRegex(q), 'i');
                query.$or = [{ keyword: rx }, { reason: rx }];
            }

            const total = await BannedKeyword.countDocuments(query);
            const p = clampPage(defaultParams, total);

            const rawItems = await BannedKeyword.find(query)
                .populate('created_by', 'full_name email')
                .sort({ created_at: -1 })
                .skip(p.skip)
                .limit(p.limit)
                .lean();

            const items = rawItems.map(item => ({
                ...item,
                is_system: false,
            }));

            return paginate(items, total, p);
        }

        // 2. Chuẩn bị danh sách từ khóa hệ thống
        const systemItems = BUILTIN_SYSTEM_KEYWORDS.map(item => ({
            _id: `sys_${item.keyword}`,
            keyword: item.keyword,
            reason: item.reason,
            created_by: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
            is_system: true,
        })).filter(item => {
            if (!q) return true;
            return (
                item.keyword.toLowerCase().includes(q) ||
                (item.reason && item.reason.toLowerCase().includes(q))
            );
        });

        // 3. Chỉ lấy từ khóa quy chuẩn hệ thống
        if (scope === 'system') {
            const total = systemItems.length;
            const p = clampPage(defaultParams, total);
            const items = systemItems.slice(p.skip, p.skip + p.limit);
            return paginate(items, total, p);
        }

        // 4. Mặc định 'all': Lấy cả Admin thêm và Hệ thống
        const query: Record<string, any> = {};
        if (q) {
            const rx = new RegExp(escapeRegex(q), 'i');
            query.$or = [{ keyword: rx }, { reason: rx }];
        }

        const customDocs = await BannedKeyword.find(query)
            .populate('created_by', 'full_name email')
            .sort({ created_at: -1 })
            .lean();

        const customItems = customDocs.map(item => ({
            ...item,
            is_system: false,
        }));

        // Tránh trùng lặp nếu admin đã thêm từ khóa trùng với hệ thống
        const customKeywordsSet = new Set(customItems.map(c => c.keyword.toLowerCase()));
        const filteredSystemItems = systemItems.filter(s => !customKeywordsSet.has(s.keyword.toLowerCase()));

        // Gộp danh sách: Admin thêm ở trên, Từ hệ thống ở dưới
        const combined = [...customItems, ...filteredSystemItems];
        const total = combined.length;
        const p = clampPage(defaultParams, total);
        const items = combined.slice(p.skip, p.skip + p.limit);

        return paginate(items, total, p);
    }

    async getStats(): Promise<{ total: number; customCount: number; systemCount: number }> {
        const customCount = await BannedKeyword.countDocuments({});
        const systemCount = BUILTIN_SYSTEM_KEYWORDS.length;
        return {
            total: customCount + systemCount,
            customCount,
            systemCount
        };
    }

    async create(adminId: string, data: { keyword: string; reason?: string }): Promise<any> {
        const keyword = String(data.keyword || '').trim().toLowerCase();
        if (!keyword) throw new Error('Từ khóa cấm là bắt buộc');

        const existing = await BannedKeyword.findOne({ keyword });
        if (existing) {
            throw new Error(`Từ khóa "${keyword}" đã có trong danh sách từ cấm`);
        }

        const doc = new BannedKeyword({
            keyword,
            reason: data.reason?.trim() || 'Vi phạm chính sách sàn',
            created_by: new mongoose.Types.ObjectId(adminId)
        });

        const saved = await doc.save();
        return saved;
    }

    async delete(id: string): Promise<boolean> {
        if (String(id).startsWith('sys_')) {
            throw new Error('Từ khóa quy chuẩn sàn được tích hợp sẵn, không thể xóa trực tiếp');
        }
        if (!mongoose.Types.ObjectId.isValid(id)) return false;
        const res = await BannedKeyword.findByIdAndDelete(id);
        return !!res;
    }

    async seedSystemKeywords(adminId: string): Promise<{ added: number }> {
        let added = 0;
        for (const item of BUILTIN_SYSTEM_KEYWORDS) {
            const exists = await BannedKeyword.findOne({ keyword: item.keyword });
            if (!exists) {
                await BannedKeyword.create({
                    keyword: item.keyword,
                    reason: item.reason,
                    created_by: new mongoose.Types.ObjectId(adminId)
                });
                added++;
            }
        }
        return { added };
    }
}

export const bannedKeywordsService = new BannedKeywordsService();
