import mongoose, { Schema } from 'mongoose';
import { cacheService } from './cache.service';
import {
    CommissionRule,
    DEFAULT_COMMISSION_PERCENT,
    parseCommissionPercent,
    pickCommissionRule,
    ruleScopeKey,
} from '../utils/commission';
import { logger } from '../utils/logger';

/**
 * Hoa hồng sàn do admin cấu hình: một mức mặc định, cộng một bảng luật theo danh mục và/hoặc
 * loại sản phẩm. Tất cả nằm trong MỘT document của `platform_settings`.
 *
 * Để chung một document vì bảng luật chỉ vài chục dòng và mọi lượt tạo sản phẩm, mọi dòng đơn
 * hàng đều phải tra — một lần đọc có cache rẻ hơn hẳn join sang collection riêng.
 */

const DOC_ID = 'commission';
const CACHE_KEY = 'vietcraft:settings:commission_v2';
const CACHE_TTL_SECONDS = 60;
/** Số bản ghi lịch sử giữ lại. Đủ để truy mọi lần đổi gần đây mà document không phình. */
const HISTORY_LIMIT = 20;
/** Trần số luật. Quá mức này là dấu hiệu cấu hình sai chứ không phải nhu cầu thật. */
export const MAX_COMMISSION_RULES = 60;
export const PRODUCT_TYPES = ['READY_TO_SHIP', 'POD_TEMPLATE', 'CUSTOM_DESIGN_REQUEST'] as const;

export interface StoredRule extends CommissionRule {
    id: string;
}

export interface CommissionChange {
    percent: number;
    /** Mức trước đó. null với bản ghi cũ chưa có trường này. */
    previous: number | null;
    changedBy: string | null;
    changedAt: Date | null;
    /** Việc đã làm. Phạm vi để dạng id, phía hiển thị tự ghép tên danh mục. */
    action: 'default' | 'rule-add' | 'rule-edit' | 'rule-delete';
    categoryId: string | null;
    productType: string | null;
}

export interface CommissionDetail {
    /** Mức mặc định, áp khi không luật nào khớp. */
    percent: number;
    updatedAt: Date | null;
    rules: StoredRule[];
    /** Mới nhất trước. */
    history: CommissionChange[];
}

const ruleSchema = new Schema(
    {
        id: { type: String, required: true },
        category_id: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
        product_type: { type: String, enum: [...PRODUCT_TYPES, null], default: null },
        percent: { type: Number, required: true },
    },
    { _id: false },
);

const platformSettingSchema = new Schema(
    {
        _id: { type: String },
        percent: { type: Number, required: true },
        rules: { type: [ruleSchema], default: [] },
        updated_by: { type: Schema.Types.ObjectId, ref: 'User' },
        updated_at: { type: Date, default: Date.now },
        history: [
            {
                _id: false,
                percent: Number,
                previous: Number,
                action: String,
                category_id: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
                product_type: { type: String, default: null },
                changed_by: { type: Schema.Types.ObjectId, ref: 'User' },
                changed_at: Date,
            },
        ],
    },
    { collection: 'platform_settings', versionKey: false },
);

const PlatformSetting =
    mongoose.models.PlatformSetting || mongoose.model('PlatformSetting', platformSettingSchema);

interface RawDoc {
    percent: number;
    updated_at?: Date;
    rules?: { id: string; category_id?: unknown; product_type?: string | null; percent: number }[];
    history?: {
        percent: number;
        previous?: number;
        action?: string;
        category_id?: unknown;
        product_type?: string | null;
        changed_by?: unknown;
        changed_at?: Date;
    }[];
}

function toStoredRules(raw: RawDoc | null): StoredRule[] {
    return (raw?.rules || []).map(r => ({
        id: r.id,
        categoryId: r.category_id ? String(r.category_id) : null,
        productType: r.product_type || null,
        percent: r.percent,
    }));
}

/** Dữ liệu đủ để tra mức cho một sản phẩm — đây là thứ được cache. */
interface ResolvedConfig {
    percent: number;
    rules: StoredRule[];
}

async function loadConfig(): Promise<ResolvedConfig> {
    return cacheService.getOrSet<ResolvedConfig>(
        CACHE_KEY,
        async () => {
            const doc = await PlatformSetting.findById(DOC_ID).lean<RawDoc | null>();
            return { percent: doc ? doc.percent : DEFAULT_COMMISSION_PERCENT, rules: toStoredRules(doc) };
        },
        CACHE_TTL_SECONDS,
    );
}

async function writeHistory(
    adminId: string,
    percent: number,
    previous: number | null,
    action: CommissionChange['action'],
    scope: { categoryId: string | null; productType: string | null } = { categoryId: null, productType: null },
) {
    await PlatformSetting.updateOne(
        { _id: DOC_ID },
        {
            $push: {
                history: {
                    $each: [
                        {
                            percent,
                            previous,
                            action,
                            category_id: scope.categoryId ? new mongoose.Types.ObjectId(scope.categoryId) : null,
                            product_type: scope.productType,
                            changed_by: adminId,
                            changed_at: new Date(),
                        },
                    ],
                    $slice: -HISTORY_LIMIT,
                },
            },
        },
        { upsert: true },
    );
    await cacheService.del(CACHE_KEY);
}

export const CommissionSetting = {
    /** Mức mặc định của sàn. */
    async getPercent(): Promise<number> {
        return (await loadConfig()).percent;
    },

    /**
     * Mức áp cho một sản phẩm cụ thể: luật cụ thể nhất khớp, không có thì mức mặc định.
     * Đây là hàm mà service sản phẩm và service đơn hàng phải gọi — không gọi getPercent().
     */
    async resolvePercent(categoryId?: string | null, productType?: string | null): Promise<number> {
        const config = await loadConfig();
        return pickCommissionRule(config.rules, categoryId, productType)?.percent ?? config.percent;
    },

    /** Admin đặt mức mặc định. Ném lỗi nếu giá trị không hợp lệ. */
    async setPercent(input: unknown, adminId: string): Promise<number> {
        const percent = parseCommissionPercent(input);
        const current = await loadConfig();
        await PlatformSetting.updateOne(
            { _id: DOC_ID },
            { $set: { percent, updated_by: adminId, updated_at: new Date() } },
            { upsert: true },
        );
        await writeHistory(adminId, percent, current.percent, 'default');
        logger.info(`[Commission] Admin ${adminId} đổi mức mặc định ${current.percent}% -> ${percent}%`);
        return percent;
    },

    /**
     * Thêm hoặc sửa một luật. `id` rỗng là thêm mới.
     *
     * Chặn hai luật cùng phạm vi: trùng phạm vi thì kết quả tra phụ thuộc thứ tự đọc từ DB,
     * và người bán sẽ thấy mức hoa hồng nhảy qua lại không lý do.
     */
    async saveRule(
        input: { id?: string; categoryId?: string | null; productType?: string | null; percent: unknown },
        adminId: string,
    ): Promise<StoredRule> {
        const percent = parseCommissionPercent(input.percent);
        const categoryId = input.categoryId ? String(input.categoryId) : null;
        const productType = input.productType || null;

        if (categoryId && !mongoose.Types.ObjectId.isValid(categoryId)) {
            throw new Error('Danh mục không hợp lệ');
        }
        if (productType && !PRODUCT_TYPES.includes(productType as (typeof PRODUCT_TYPES)[number])) {
            throw new Error('Loại sản phẩm không hợp lệ');
        }
        if (!categoryId && !productType) {
            throw new Error('Luật phải giới hạn theo danh mục hoặc loại sản phẩm. Mức áp cho tất cả là mức mặc định.');
        }

        const current = await loadConfig();
        const id = input.id || new mongoose.Types.ObjectId().toString();
        const scope = ruleScopeKey({ categoryId, productType, percent });
        const clash = current.rules.find(r => r.id !== id && ruleScopeKey(r) === scope);
        if (clash) throw new Error('Đã có luật cho đúng phạm vi này. Sửa luật đó thay vì thêm luật mới.');

        const existing = current.rules.find(r => r.id === id);
        if (!existing && current.rules.length >= MAX_COMMISSION_RULES) {
            throw new Error(`Tối đa ${MAX_COMMISSION_RULES} luật.`);
        }

        const stored = {
            id,
            category_id: categoryId ? new mongoose.Types.ObjectId(categoryId) : null,
            product_type: productType,
            percent,
        };
        if (existing) {
            await PlatformSetting.updateOne({ _id: DOC_ID, 'rules.id': id }, { $set: { 'rules.$': stored } });
        } else {
            await PlatformSetting.updateOne({ _id: DOC_ID }, { $push: { rules: stored } }, { upsert: true });
        }
        await writeHistory(adminId, percent, existing?.percent ?? null, existing ? 'rule-edit' : 'rule-add', {
            categoryId,
            productType,
        });
        logger.info(`[Commission] Admin ${adminId} ${existing ? 'sửa' : 'thêm'} luật ${scope} = ${percent}%`);
        return { id, categoryId, productType, percent };
    },

    async deleteRule(id: string, adminId: string): Promise<void> {
        const current = await loadConfig();
        const rule = current.rules.find(r => r.id === id);
        if (!rule) throw new Error('Luật không tồn tại');
        await PlatformSetting.updateOne({ _id: DOC_ID }, { $pull: { rules: { id } } });
        await writeHistory(adminId, rule.percent, rule.percent, 'rule-delete', {
            categoryId: rule.categoryId,
            productType: rule.productType,
        });
        logger.info(`[Commission] Admin ${adminId} xoá luật ${ruleScopeKey(rule)}`);
    },

    /** Mức mặc định, bảng luật và lịch sử đổi. `changedBy` là id, phía admin tra tên. */
    async getDetail(): Promise<CommissionDetail> {
        const doc = await PlatformSetting.findById(DOC_ID).lean<RawDoc | null>();
        const history = (doc?.history || [])
            .map(h => ({
                percent: h.percent,
                previous: h.previous ?? null,
                action: (h.action as CommissionChange['action']) || 'default',
                categoryId: h.category_id ? String(h.category_id) : null,
                productType: h.product_type || null,
                changedBy: h.changed_by ? String(h.changed_by) : null,
                changedAt: h.changed_at ?? null,
            }))
            .reverse();
        return {
            percent: doc ? doc.percent : DEFAULT_COMMISSION_PERCENT,
            updatedAt: doc?.updated_at ?? null,
            rules: toStoredRules(doc),
            history,
        };
    },
};
