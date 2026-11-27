import mongoose from 'mongoose';
import { llmJsonText } from './llm-json';
import { AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { AnalyticsViewer } from './ai-gateway.service';
import { Product } from '../../product/infrastructure/models/product.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { Order } from '../../order/infrastructure/models/order.model';
import { BlankClient, Blank } from '../../product/application/blank-client.service';
import { ProductEvent } from '../infrastructure/models/product-event.model';
import { cacheService } from '../../../shared/services/cache.service';
import {
    isValidDemandOrder,
    orderGmv,
    baselineDailyRate,
    ordersInWindow,
    orderStatusBreakdown,
    overlappingCampaigns,
    campaignTimingBasis,
    measuredUplift,
    targetOrders as computeTargetOrders,
    vnDayStart,
    vnDayEnd,
    RATE_WINDOW_DAYS,
    parseCommissionRate,
    netMarginPct,
} from './seasonal-math';
import { PlatformCostConfig } from '../../admin/infrastructure/models/system-config.model';
import { writableShopId } from './seasonal-access';
import { eventYearOf, planLookupKey, planViewFor } from './seasonal-plan';
import { SeasonalPlan } from '../infrastructure/models/seasonal-plan.model';

const ORDER_LOOKBACK_DAYS = 400;
const ORDER_LOOKBACK_LIMIT = 3000;

export interface GeminiAdvisoryResult {
    title: string;
    advice: string;
}

export interface TraitActionItem {
    priority: string;
    title: string;
    desc: string;
    traitKey: string;
}

export interface ShopSeasonalIdea {
    id: string;
    title: string;
    concept: string;
    target_price_vnd: number;
    estimated_cost_vnd: number;
    expected_margin_pct: number;
    tags: string[];
    why_it_fits_shop: string;
    source_type: 'llm_scoped' | 'draft_synthesized';
    draft_basis: {
        shop_style: string;
        price_band: string;
        trend_signal: string;
        top_keywords: string[];
    };
}

class BoundedTtlCache<T> {
    private store = new Map<string, { data: T; expiresAt: number }>();
    constructor(private readonly maxEntries = 200) {}

    get(key: string): { data: T; expiresAt: number } | undefined {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= Date.now()) {
            this.store.delete(key);
            return undefined;
        }
        return entry;
    }

    set(key: string, value: { data: T; expiresAt: number }): void {
        if (this.store.has(key)) {
            this.store.delete(key);
        } else if (this.store.size >= this.maxEntries) {
            const now = Date.now();
            for (const [k, v] of this.store) {
                if (v.expiresAt <= now) this.store.delete(k);
            }
            while (this.store.size >= this.maxEntries) {
                const oldestKey = this.store.keys().next().value;
                if (oldestKey === undefined) break;
                this.store.delete(oldestKey);
            }
        }
        this.store.set(key, value);
    }
}

export class SeasonalAnalyticsService {
    /** Phí sàn admin cấu hình (cùng nguồn với checkout), cache 10 phút. */
    private static commissionCache: { rate: number; expiresAt: number } | null = null;
    static async commissionRate(): Promise<number> {
        const now = Date.now();
        if (this.commissionCache && this.commissionCache.expiresAt > now) return this.commissionCache.rate;
        const cfg = await PlatformCostConfig.findOne().sort({ updated_at: -1 }).select('policies').lean().catch(() => null);
        const rate = parseCommissionRate(cfg);
        this.commissionCache = { rate, expiresAt: now + 10 * 60_000 };
        return rate;
    }

    private static geminiAdvisoryCache = new BoundedTtlCache<GeminiAdvisoryResult | null>(200);
    private static traitActionsCache = new BoundedTtlCache<TraitActionItem[] | null>(200);
    private static seasonalIdeasCache = new BoundedTtlCache<ShopSeasonalIdea[]>(200);

    static async fetchGeminiSeasonalIdeas(params: {
        shopId: string;
        liveShopOid?: mongoose.Types.ObjectId | null;
        shopName: string;
        catName: string;
        campId: string;
        campName: string;
        eventYear: number;
        persistedIdeas?: ShopSeasonalIdea[] | null;
        shopStyleKeywords: string[];
        shopSampleTitles: string[];
        priceBand: { min: number; max: number; avg: number };
        topOppKeywords: Array<{ tag: string; volume: number; competition: number; wow?: number | null }>;
        ordersGrowth?: number | null;
        spendingGrowth?: number | null;
        comboInd?: number | null;
        occasionIndustryClusters?: Array<{ title?: string; price_vnd?: number; sold_count?: number; platform?: string }>;
        occasionIndustryPriceBand?: { min?: number; max?: number; avg?: number };
        industryScale?: { productsCount?: number; sellersCount?: number; totalSold?: number };
    }): Promise<ShopSeasonalIdea[]> {
        const commissionRate = await SeasonalAnalyticsService.commissionRate();
        // Ưu tiên 1: Ý tưởng đã lưu bền vững trong MongoDB cho shop + dịp + năm (không bị mất hay đè khi restart server)
        if (Array.isArray(params.persistedIdeas) && params.persistedIdeas.length > 0) {
            return params.persistedIdeas;
        }

        const safeCampKey = `${String(params.campId || 'event').replace(/[^a-zA-Z0-9_-]/g, '_')}_${params.eventYear}`;
        const cacheKey = `ideas_${params.shopId}_${safeCampKey}_${params.catName}`;
        const cached = SeasonalAnalyticsService.seasonalIdeasCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }

        const priceBandStr = `${Math.round(params.priceBand.min / 1000)}k – ${Math.round(params.priceBand.max / 1000)}k`;
        const shopStyleStr = params.shopStyleKeywords.slice(0, 5).join(', ') || params.catName;
        const kwNames = params.topOppKeywords.slice(0, 4).map(k => k.tag);
        const trendSig = params.ordersGrowth != null ? `Cầu dịp +${params.ordersGrowth}%, AOV ngành +${params.spendingGrowth ?? 0}%` : 'Dữ liệu đa sàn';

        // Bản phác thảo (Draft) tổng hợp từ dữ liệu thật của shop + DL/STL + đa sàn
        const draftBasis = {
            shop_style: shopStyleStr,
            price_band: priceBandStr,
            trend_signal: trendSig,
            top_keywords: kwNames,
        };

        const buildFallbackIdeas = (): ShopSeasonalIdea[] => {
            const clusters = params.occasionIndustryClusters || [];
            const kws = params.topOppKeywords.length > 0 ? params.topOppKeywords : [{ tag: 'quà tặng', volume: 0, competition: 0 }];
            const stylePrimary = params.shopStyleKeywords[0] || params.catName;
            const shopStyleClean = params.shopStyleKeywords.slice(0, 3).join(', ') || params.catName;
            const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

            return [0, 1, 2].map((idx) => {
                const kwInfo = kws[idx % kws.length];
                const kw = kwInfo?.tag || 'quà tặng';
                const cl = clusters[idx] as any;
                const clKw = (cl?.keyword || kw).trim();
                const indPrice = cl?.price_vnd && cl.price_vnd >= 30000 ? cl.price_vnd : params.priceBand.avg;
                const targetPrice = Math.max(120000, Math.round(((params.priceBand.avg * 0.6 + indPrice * 0.4) * (1 + idx * 0.05)) / 5000) * 5000);
                const estCost = Math.round((targetPrice * 0.48) / 1000) * 1000;
                const marginPct = netMarginPct(targetPrice, estCost, commissionRate);

                let ideaTitle = '';
                let ideaConcept = '';
                if (idx === 0) {
                    ideaTitle = `${cap(stylePrimary)} phiên bản ${params.campName} (${kw})`;
                    ideaConcept = `Phát triển mẫu mới giữ đúng phom dáng và gu ${shopStyleClean} của ${params.shopName}, bổ sung chi tiết/màu sắc chủ đề ${params.campName} để đón từ khóa "${kw}".`;
                } else if (idx === 1) {
                    ideaTitle = `Combo quà tặng ${stylePrimary} & ${clKw} dịp ${params.campName}`;
                    ideaConcept = `Đóng gói set quà gồm sản phẩm ${stylePrimary} chủ lực của ${params.shopName} kèm ${clKw} và thiệp chúc, giúp tăng giá trị mỗi đơn trong mùa cao điểm.`;
                } else {
                    ideaTitle = `${cap(kw)} phong cách ${stylePrimary} cho ${params.campName}`;
                    ideaConcept = `Khai thác nhóm nhu cầu "${kw}" theo phong cách ${shopStyleClean} của shop, định vị tầm giá ${targetPrice.toLocaleString('vi-VN')}đ dễ chốt đơn dịp lễ.`;
                }

                const kwMetricStr = kwInfo?.volume
                    ? `từ khóa "${kw}" ghi nhận ${Number(kwInfo.volume).toLocaleString('vi-VN')} lượt bán/chỉ số (${kwInfo.competition} gian hàng cạnh tranh)`
                    : `từ khóa "${kw}" có ${kwInfo?.competition ?? 0} gian hàng cạnh tranh`;
                const clMetricStr = cl?.sold_count
                    ? `; nhóm "${clKw}" toàn ngành đang đạt ${Number(cl.sold_count).toLocaleString('vi-VN')} lượt bán trên ${cl.platform || 'Tiki'}`
                    : '';

                return {
                    id: `ai_idea_${params.campId}_${idx}`,
                    title: ideaTitle,
                    concept: ideaConcept,
                    target_price_vnd: targetPrice,
                    estimated_cost_vnd: estCost,
                    expected_margin_pct: Math.max(20, marginPct),
                    tags: [kw, ...params.shopStyleKeywords.slice(0, 2)].filter(Boolean),
                    why_it_fits_shop: `Phù hợp khung giá ${priceBandStr} của shop; ${kwMetricStr}${clMetricStr}.`,
                    source_type: 'draft_synthesized',
                    draft_basis: draftBasis,
                };
            });
        };

        const persistIdeasToMongo = async (ideasToSave: ShopSeasonalIdea[]) => {
            if (!params.liveShopOid || ideasToSave.length === 0) return;
            try {
                await Shop.updateOne(
                    { _id: params.liveShopOid },
                    {
                        $set: {
                            [`settings.seasonal_preferences.generated_ideas.${safeCampKey}`]: {
                                ideas: ideasToSave,
                                event_year: params.eventYear,
                                generated_at: new Date().toISOString(),
                            },
                        },
                    }
                );
            } catch {
                // Bỏ qua lỗi ghi nền để không chặn response
            }
        };

        const redisKey = `vietcraft:seasonal:ideas:v3:${cacheKey}`;
        const redisCached = await cacheService.get<ShopSeasonalIdea[]>(redisKey).catch(() => null);
        if (Array.isArray(redisCached) && redisCached.length > 0 && redisCached[0]?.source_type === 'llm_scoped') {
            SeasonalAnalyticsService.seasonalIdeasCache.set(cacheKey, { data: redisCached, expiresAt: Date.now() + 1800 * 1000 });
            await persistIdeasToMongo(redisCached);
            return redisCached;
        }

        try {
            const prompt = `Bạn là chuyên gia phát triển sản phẩm TMĐT. Hãy đọc BẢN PHÁC THẢO DỮ LIỆU THẬT dưới đây và tổng hợp đúng 3 ý tưởng sản phẩm MỚI cho shop (phải bám sát SỐ LIỆU TOÀN NGÀNH CỦA DỊP ${params.campName} ${params.eventYear} đồng thời mang PHONG CÁCH RIÊNG của shop; KHÔNG tự bịa thêm số liệu ngoài bản phác thảo; TUYỆT ĐỐI KHÔNG nhắc tới các năm cũ như 2023, 2024, 2025 — nếu cần ghi năm chỉ được dùng năm ${params.eventYear}):

BẢN PHÁC THẢO (STRICT SCOPE):
- Shop: "${params.shopName}" · Ngành: "${params.catName}" · Năm sự kiện: ${params.eventYear}
- Sản phẩm mẫu & phong cách shop: ${params.shopSampleTitles.slice(0, 4).join(' | ') || 'Chưa có'} (từ khóa phong cách: ${shopStyleStr})
- Khung giá shop: ${priceBandStr} (trung bình ${params.priceBand.avg.toLocaleString('vi-VN')}đ)
- Dịp mua sắm: ${params.campName} ${params.eventYear}
- Số liệu TOÀN NGÀNH trong dịp ${params.campName}:
  + Quy mô ngành: ${params.industryScale?.productsCount ?? 'N/A'} sản phẩm từ ${params.industryScale?.sellersCount ?? 'N/A'} gian hàng (${params.industryScale?.totalSold ?? 'N/A'} lượt bán đa sàn)
  + Dải giá ngành dịp này: ${params.occasionIndustryPriceBand?.min ? `${Math.round(params.occasionIndustryPriceBand.min / 1000)}k–${Math.round((params.occasionIndustryPriceBand.max || 0) / 1000)}k` : priceBandStr}
  + Nhóm sản phẩm đang bán chạy toàn ngành dịp ${params.campName}: ${(params.occasionIndustryClusters || []).slice(0, 3).map(c => `"${c.title}" (${c.sold_count ?? 0} bán, ${c.price_vnd?.toLocaleString('vi-VN') ?? ''}đ, ${c.platform})`).join('; ') || 'Đang tổng hợp'}
- Tín hiệu thuật toán (QuantileForecaster + STL 5 năm): Cầu cao điểm +${params.ordersGrowth ?? 'N/A'}%, Giá trị đơn ngành +${params.spendingGrowth ?? 'N/A'}%, Tỷ lệ combo ngành ${params.comboInd ?? 'N/A'}%
- Từ khóa cơ hội toàn ngành: ${params.topOppKeywords.slice(0, 5).map(k => `"${k.tag}" (nhu cầu: ${k.volume}, đối thủ: ${k.competition})`).join('; ')}

Yêu cầu trả về JSON array đúng 3 phần tử:
[
  {
    "title": "Tên ý tưởng sản phẩm mới hấp dẫn, kết hợp nhu cầu dịp ${params.campName} và phong cách shop (8-14 từ, không ghi năm cũ)",
    "concept": "Mô tả cách thiết kế / đóng gói / combo cụ thể cho dịp ${params.campName} ${params.eventYear} (1-2 câu)",
    "target_price_vnd": số nguyên VND phù hợp khung giá shop & ngành (${Math.min(params.priceBand.min, params.occasionIndustryPriceBand?.min || params.priceBand.min)}-${Math.max(Math.round(params.priceBand.max * 1.25), params.occasionIndustryPriceBand?.max || params.priceBand.max)}),
    "tags": ["tag 1", "tag 2", "tag 3"],
    "why_it_fits_shop": "Nêu rõ cả số liệu toàn ngành của dịp ${params.campName} lẫn sự phù hợp với phong cách shop (1 câu)"
  }
]`;
            const rawText = await llmJsonText(prompt, 15000);
            const parsed = rawText ? JSON.parse(rawText) : null;
            if (Array.isArray(parsed) && parsed.length >= 2) {
                const ideas: ShopSeasonalIdea[] = parsed.slice(0, 3).map((item: any, idx: number) => {
                    const price = Math.max(50000, Math.round((Number(item.target_price_vnd) || params.priceBand.avg) / 1000) * 1000);
                    const estCost = Math.round((price * 0.46) / 1000) * 1000;
                    const marginPct = netMarginPct(price, estCost, commissionRate);
                    return {
                        id: `ai_idea_${params.campId}_${idx}`,
                        title: String(item.title || '').replace(/[*_#]/g, '').trim(),
                        concept: String(item.concept || '').replace(/[*_#]/g, '').trim(),
                        target_price_vnd: price,
                        estimated_cost_vnd: estCost,
                        expected_margin_pct: Math.max(15, marginPct),
                        tags: Array.isArray(item.tags) ? item.tags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 5) : kwNames.slice(0, 3),
                        why_it_fits_shop: String(item.why_it_fits_shop || '').replace(/[*_#]/g, '').trim(),
                        source_type: 'llm_scoped' as const,
                        draft_basis: draftBasis,
                    };
                }).filter(x => x.title && x.concept);
                if (ideas.length > 0) {
                    SeasonalAnalyticsService.seasonalIdeasCache.set(cacheKey, { data: ideas, expiresAt: Date.now() + 1800 * 1000 });
                    await cacheService.set(redisKey, ideas, 86400).catch(() => {});
                    await persistIdeasToMongo(ideas);
                    return ideas;
                }
            }
        } catch {
            // Fallback an toàn về bản phác thảo tổng hợp từ số liệu thật
        }
        const fb = buildFallbackIdeas();
        SeasonalAnalyticsService.seasonalIdeasCache.set(cacheKey, { data: fb, expiresAt: Date.now() + 60 * 1000 });
        return fb;
    }

    static async fetchGeminiTraitActions(params: {
        campId: string;
        campName: string;
        catName: string;
        primaryKw: string;
        earlyDateStr: string;
        peak3DaysStr: string;
        ordersGrowth?: number | null;
        spendingGrowth?: number | null;
        earlyDays?: number | null;
        peakShop?: number | null;
        peakInd?: number | null;
        comboShop?: number | null;
        comboInd?: number | null;
        voucherShop?: number | null;
        voucherInd?: number | null;
    }): Promise<TraitActionItem[] | null> {
        const cacheKey = `ta_${params.campId}_${params.catName}_${params.ordersGrowth}_${params.spendingGrowth}_${params.comboShop}_${params.voucherShop}`;
        const cached = SeasonalAnalyticsService.traitActionsCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }

        try {
            const prompt = `Bạn là chuyên gia vận hành TMĐT. Dựa trên số liệu ĐẶC THÙ của dịp "${params.campName}" cho shop ngành "${params.catName}" (từ khóa chính: "${params.primaryKw}"):
- Tăng trưởng đơn cao điểm toàn ngành: +${params.ordersGrowth ?? 'N/A'}% so với ngày thường
- Giá trị mỗi đơn toàn ngành: +${params.spendingGrowth ?? 'N/A'}%
- Khách đặt sớm: ${params.earlyDays ?? 'N/A'} ngày (tức từ ${params.earlyDateStr})
- Đơn rơi vào 3 ngày cao điểm (${params.peak3DaysStr}): Shop ${params.peakShop ?? 'chưa đủ đơn'}% vs Toàn ngành ${params.peakInd ?? 'N/A'}%
- Đơn mua theo bộ (combo): Shop ${params.comboShop ?? 'chưa đủ đơn'}% vs Toàn ngành ${params.comboInd ?? 'N/A'}%
- Đơn dùng mã giảm giá: Shop ${params.voucherShop ?? 'chưa đủ đơn'}% vs Toàn ngành ${params.voucherInd ?? 'N/A'}%

Hãy trả về đúng 3 việc nên làm ĐẶC THÙ cho dịp ${params.campName} (không viết chung chung giống mọi dịp khác, không dùng từ "AI"), dạng JSON array:
[
  {"priority":"Ưu tiên cao","title":"... (<=9 từ, cụ thể cho ${params.campName})","desc":"... (1 câu ngắn nêu rõ số liệu thật ở trên & cách làm)","traitKey":"comboPurchase|voucherSensitivity|higherSpending"},
  {"priority":"Nên làm","title":"... (gắn ngày ${params.earlyDateStr})","desc":"... (1 câu ngắn)","traitKey":"earlyOrder"},
  {"priority":"Vận hành","title":"... (gắn ngày ${params.peak3DaysStr})","desc":"... (1 câu ngắn)","traitKey":"peakClustering"}
]`;

            const rawText = await llmJsonText(prompt, 12000);
            if (!rawText) return null;
            const parsed = JSON.parse(rawText);
            if (Array.isArray(parsed) && parsed.length >= 2) {
                const cleaned: TraitActionItem[] = parsed.slice(0, 3).map((it: any) => ({
                    priority: String(it.priority || 'Nên làm').trim(),
                    title: String(it.title || '').replace(/[*_#]/g, '').trim(),
                    desc: String(it.desc || '').replace(/[*_#]/g, '').trim(),
                    traitKey: String(it.traitKey || 'ordersGrowth').trim(),
                })).filter(it => it.title && it.desc);
                if (cleaned.length > 0) {
                    SeasonalAnalyticsService.traitActionsCache.set(cacheKey, { data: cleaned, expiresAt: Date.now() + 1800 * 1000 });
                    return cleaned;
                }
            }
        } catch {
            SeasonalAnalyticsService.traitActionsCache.set(cacheKey, { data: null, expiresAt: Date.now() + 300 * 1000 });
        }
        return null;
    }

    static async fetchGeminiSeasonalAdvisory(params: {
        campName: string;
        eventYear: number;
        catName: string;
        kw: string;
        growthPct: number | null;
        matchCount: number;
        firstMatchedTitle: string;
        totalStock: number;
        campSavedCount: number;
        campOrdersCount: number;
        currentPhase: string;
        isUrgent: boolean;
        daysToCutoff: number;
        tracStr: string;
        cutStr: string;
        evStr: string;
    }): Promise<GeminiAdvisoryResult | null> {
        const cacheKey = `${params.campName}_${params.eventYear}_${params.catName}_${params.matchCount}_${params.campSavedCount}_${params.campOrdersCount}_${params.isUrgent ? 'urg' : params.currentPhase}`;
        const cached = SeasonalAnalyticsService.geminiAdvisoryCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }

        try {
            const growthLine = params.growthPct !== null
                ? `- Lượt tìm kiếm dịp này (Google Trends, KHÔNG phải số đơn): ${params.growthPct >= 0 ? '+' : ''}${params.growthPct}% so với ngày thường\n`
                : '';
            const growthRequirement = params.growthPct !== null
                ? `nhu cầu tìm kiếm (${params.growthPct >= 0 ? '+' : ''}${params.growthPct}% lượt tìm)`
                : 'xu hướng tìm kiếm thực tế';

            const prompt = `Bạn là Giám đốc Tăng trưởng TMĐT thực chiến (Shopee, TikTok Shop, Amazon).
Dựa vào dữ liệu thực tế:
- Dịp mua sắm: ${params.campName} năm ${params.eventYear}
- Ngành hàng của shop: ${params.catName}
- Từ khóa ngách thịnh hành: "${params.kw}"
${growthLine}- Tình trạng shop: ${params.matchCount > 0 ? `Đã có ${params.matchCount} mẫu liên quan (mẫu: "${params.firstMatchedTitle}", tồn kho: ${params.totalStock} cái)` : 'Chưa có mẫu nào cho dịp này'}
- Ý tưởng đã lưu vào kế hoạch: ${params.campSavedCount} mẫu
- Đơn hàng thực tế đã phát sinh: ${params.campOrdersCount} đơn
- Thời điểm hiện tại: ${params.isUrgent ? `Cực kỳ khẩn cấp, còn ${params.daysToCutoff} ngày là đến hạn chốt an toàn (${params.cutStr}) trước sự kiện (${params.evStr})` : params.currentPhase === 'traction' ? `Đang trong đợt mở bán gom đơn trước ngày cao điểm (${params.evStr})` : `Chuẩn bị nguồn hàng (bắt đầu mở bán vào ${params.tracStr})`}

Yêu cầu nghiệp vụ:
1. Viết 1 tiêu đề (title, tối đa 8 từ), thể hiện hành động cấp bách cần làm ngay.
2. Viết 1 lời khuyên thực chiến (advice, tối đa 2-3 câu), phân tích thẳng vào xu hướng, ${growthRequirement} và giải quyết nỗi đau của seller (AOV, combo, nguy cơ đứt hàng, xưởng quá tải hoặc kẹt vận chuyển).
3. Tuyệt đối KHÔNG nhắc đến từ "AI", không viết lý thuyết chung chung sáo rỗng.
4. Trả về đúng định dạng JSON: {"title": "...", "advice": "..."}`;

            const rawText = await llmJsonText(prompt, 6000);
            if (!rawText) return null;

            const parsed = JSON.parse(rawText);
            if (parsed.title && parsed.advice) {
                const result: GeminiAdvisoryResult = {
                    title: String(parsed.title).replace(/[*_#]/g, '').trim(),
                    advice: String(parsed.advice).replace(/[*_#]/g, '').trim()
                };
                SeasonalAnalyticsService.geminiAdvisoryCache.set(cacheKey, { data: result, expiresAt: Date.now() + 3600 * 1000 });
                return result;
            }
        } catch {
            // Fallback an toàn về rule-based bên dưới khi không có mạng hoặc API lỗi
            SeasonalAnalyticsService.geminiAdvisoryCache.set(cacheKey, { data: null, expiresAt: Date.now() + 300 * 1000 });
        }
        return null;
    }

    static async enrichSeasonalData(data: any, req: AuthenticatedRequest, viewer: AnalyticsViewer) {
        if (!data) return data;

        data.seller_shop_name = viewer.shop_name || 'Gian hàng của bạn';
        data.is_live_shop = Boolean(viewer.live_shop_id);
        data.can_save_plan = writableShopId(viewer) !== null;

        const hasValidLiveShop = Boolean(viewer.live_shop_id && mongoose.Types.ObjectId.isValid(viewer.live_shop_id));
        const liveShopOid = hasValidLiveShop ? new mongoose.Types.ObjectId(viewer.live_shop_id!) : null;
        const hasValidAnalysedShop = Boolean(viewer.analysed_shop_id && mongoose.Types.ObjectId.isValid(viewer.analysed_shop_id));

        // Chạy song song các truy vấn DB độc lập để giảm tối đa thời gian chờ roundtrip MongoDB Atlas
        const [shopProducts, sellerBlanks, initialRealOrders, shopDoc] = await Promise.all([
            liveShopOid
                ? Product.find({
                    shop_id: liveShopOid,
                    listing_status: { $ne: 'EXPIRED' }
                }).select('_id title slug images categories category_ids tags product_type original_price stock_alert_threshold source_idea_id').lean().catch(() => [])
                : Promise.resolve([] as any[]),
            (data.events && Array.isArray(data.events))
                ? BlankClient.listBlanks(req.user?.id).catch(() => [] as Blank[])
                : Promise.resolve([] as Blank[]),
            // ~13 tháng đơn để phủ cùng kỳ năm trước; lọc "đơn hợp lệ" bằng isValidDemandOrder bên dưới
            liveShopOid
                ? Order.find({
                    shop_id: liveShopOid,
                    created_at: { $gte: new Date(Date.now() - ORDER_LOOKBACK_DAYS * 86400000) },
                    order_status: { $ne: 'CANCELLED' },
                    is_simulated: { $ne: true }
                }).select('order_code items shipping_address buyer_id created_at financial_breakdown coupon_code order_type is_pod order_status payment_method payment_status refund_status notes').sort({ created_at: -1 }).limit(ORDER_LOOKBACK_LIMIT).lean().catch(() => [])
                : Promise.resolve([] as any[]),
            hasValidAnalysedShop
                ? Shop.findById(viewer.analysed_shop_id).select('settings').lean().catch(() => null)
                : Promise.resolve(null),
        ]);

        const shopRealOrders: any[] = (initialRealOrders as any[]).filter(isValidDemandOrder);
        const shop8WeeksOrders = shopRealOrders.filter(o => new Date(o.created_at).getTime() >= Date.now() - 56 * 86400000).length;

        // Nhóm ngành của shop do AI xác định từ danh mục thật của sản phẩm (một bộ mã chung, app/core/category_groups.py)
        const aiCategory = data.seller_category || {};
        const detectedSlug: string = aiCategory.slug || data.selected_category_slug || 'tong-hop';
        const detectedName: string = aiCategory.name || 'Toàn ngành hàng TMĐT';
        data.seller_category = { slug: detectedSlug, name: detectedName, source: aiCategory.source || 'none' };

        if (data.events && Array.isArray(data.events)) {
            for (const event of data.events) {
                if (event.pod_blanks && Array.isArray(event.pod_blanks)) {
                    for (const pb of event.pod_blanks) {
                        const bt = (pb.blank_type || '').toLowerCase();
                        const matched = sellerBlanks.find(b => {
                            const bId = (b._id || '').toLowerCase();
                            const bCat = (b.category || '').toLowerCase();
                            if (bt.includes('tshirt') || bt.includes('áo')) return bId.includes('tshirt') || bCat.includes('thời trang');
                            if (bt.includes('mug') || bt.includes('cốc') || bt.includes('ly')) return bId.includes('mug') || bCat.includes('gia dụng') || bCat.includes('quà');
                            if (bt.includes('tote') || bt.includes('túi')) return bId.includes('tote') || bCat.includes('phụ kiện');
                            if (bt.includes('canvas') || bt.includes('tranh') || bt.includes('khung')) return bId.includes('frame') || bCat.includes('trang trí');
                            return false;
                        });
                        if (matched) {
                            pb.matched_blank = {
                                _id: matched._id,
                                title: matched.title,
                                category: matched.category,
                                default_image: matched.default_image,
                                base_cost: matched.variations?.[0]?.base_cost || 0,
                                printer_name: matched.printer_name || 'Xưởng in liên kết',
                                is_connected: true
                            };
                        }
                    }
                }

                const evName = (event.name || '').toLowerCase();
                const evWords: string[] = evName.split(/\s+/).filter(Boolean);
                event.matching_shop_products = shopProducts.filter((p: any) => {
                    const pTitle = (p.title || '').toLowerCase();
                    const pTags: string[] = (p.tags || []).map((t: string) => t.toLowerCase());
                    const pCats: string[] = (p.categories || []).map((c: string) => c.toLowerCase());
                    return evWords.some((w: string) => w.length > 2 && (pTitle.includes(w) || pTags.some((t: string) => t.includes(w)) || pCats.some((c: string) => c.includes(w))));
                }).slice(0, 4);
            }

            data.all_seller_blanks = sellerBlanks.map(b => ({
                _id: b._id,
                title: b.title,
                category: b.category,
                default_image: b.default_image,
                base_cost: b.variations?.[0]?.base_cost || 0,
                printer_name: b.printer_name || 'Xưởng in liên kết'
            }));
        }

        // Bổ sung số liệu thực tế gian hàng vào all_campaigns
        if (Array.isArray(data.all_campaigns)) {
            for (const camp of data.all_campaigns) {
                const ckw = (camp.search_keywords?.[0] || camp.name || '').toLowerCase();
                camp.matching_shop_products = shopProducts.filter((p: any) => {
                    const pTitle = (p.title || '').toLowerCase();
                    const pTags: string[] = (p.tags || []).map((t: string) => t.toLowerCase());
                    return pTitle.includes(ckw) || pTags.some((t: string) => t.includes(ckw));
                }).slice(0, 4);

                if (shop8WeeksOrders >= 100 && (camp.timing?.days_to_event ?? 100) <= 30) {
                    camp.confidence = {
                        level: 'high',
                        text: 'Cao',
                        dots: 4,
                        reason: `Shop có ${shop8WeeksOrders} đơn đối soát trong 8 tuần qua, dữ liệu tin cậy cao.`
                    };
                    camp.confidence_text = 'Cao';
                    camp.confidence_dots = 4;
                }
            }
        }

        // Đối soát ma trận từ khóa cơ hội với sản phẩm thực tế trong shop
        if (Array.isArray(data.opportunity_keywords) && shopProducts.length > 0) {
            for (const kw of data.opportunity_keywords) {
                const kwLower = (kw.tag || '').toLowerCase();
                const matchedProd = shopProducts.find((p: any) => {
                    const pTitle = (p.title || '').toLowerCase();
                    const pTags = (p.tags || []).map((t: string) => t.toLowerCase());
                    return pTitle.includes(kwLower) || pTags.some((t: string) => t.includes(kwLower) || kwLower.includes(t));
                });
                if (matchedProd) {
                    kw.matched_product = {
                        id: matchedProd._id,
                        title: matchedProd.title,
                        images: matchedProd.images
                    };
                    kw.is_in_shop = true;
                } else {
                    kw.is_in_shop = false;
                }
            }
        }

        // 1. Phân tích lịch sử đơn hàng THẬT của gian hàng để bóc tách luồng traffic & động lực mua sắm
        const getOrderAmount = orderGmv;

        // 2. Cá nhân hóa phễu chuyển đổi & đơn hàng thực tế theo ĐẶC THÙ CỦA TỪNG DỊP
        const campId = (data.active_campaign?.id || '').toLowerCase();
        const activeCamp = data.active_campaign;
        const launchWin = activeCamp?.launch_window || {};

        // Kỳ đo hiệu quả của dịp = từ ngày mở bán (traction_start) đến ngày lễ.
        // Giai đoạn chuẩn bị (rd_start → traction_start) là lúc lên mẫu, đơn khi đó chưa phải đơn của dịp.
        let startStr = launchWin.traction_start || launchWin.start;
        let endStr = launchWin.peak_date || launchWin.end;

        if (!startStr || !endStr) {
            const matchedInAll = (data.all_campaigns || []).find((c: any) => c.id === campId);
            if (matchedInAll?.launch_window) {
                startStr = startStr || matchedInAll.launch_window.traction_start || matchedInAll.launch_window.start;
                endStr = endStr || matchedInAll.launch_window.peak_date || matchedInAll.launch_window.end;
            }
        }

        if (!startStr || !endStr) {
            const currentYear = new Date().getFullYear();
            startStr = startStr || `${currentYear}-11-01`;
            endStr = endStr || `${currentYear}-12-25`;
        }

        const winStart = vnDayStart(String(startStr).slice(0, 10));
        const winEnd = vnDayEnd(String(endStr).slice(0, 10));

        // Độ nâng LƯỢT TÌM KIẾM của dịp (Google Trends) do AI đo: chỉ để tham khảo, không nhân vào số đơn
        const uplift = measuredUplift(data.forecast_method_info);
        const searchUpliftPct: number | null = uplift ? Math.round((uplift.value - 1) * 100) : null;

        const nowTime = new Date();
        const isUpcoming = nowTime < winStart;

        const OCCASION_KEYWORDS: Record<string, RegExp> = {
            tet: /(tết|nguyên đán|quý mão|tân mão|bính ngọ|xuân|chúc mừng năm mới|áo dài|lì xì)/i,
            noel: /(noel|giáng sinh|christmas|xmas|ông già noel|cây thông|hộp quà|thiệp|set quà)/i,
            '12/12': /(12\/12|siêu sale|xả hàng|cuối năm|áo ấm)/i,
            '11/11': /(11\/11|độc thân|sale khủng)/i,
            valentine: /(valentine|lễ tình nhân|14\/2|tình nhân|socola|quà tặng đôi)/i,
            '8/3': /(8\/3|quốc tế phụ nữ|phụ nữ)/i,
            '20/10': /(20\/10|phụ nữ việt nam)/i,
            '20/11': /(20\/11|nhà giáo|thầy cô|tri ân)/i,
            trung_thu: /(trung thu|rằm tháng tám|bánh trung thu|đèn lồng)/i,
            halloween: /(halloween|hóa trang|ma quỷ|bí ngô)/i
        };

        const matchedOccasionRegex = OCCASION_KEYWORDS[campId]
            || Object.entries(OCCASION_KEYWORDS).find(([k]) => campId.includes(k))?.[1]
            || null;

        // Đơn trong kỳ dịp: mọi đơn hợp lệ của shop đặt trong kỳ đo; tách riêng đơn đúng hàng của dịp (direct) bên dưới
        const campRealOrders = ordersInWindow(shopRealOrders, winStart, winEnd);
        const campStatus = orderStatusBreakdown(campRealOrders);

        const directOrders = matchedOccasionRegex
            ? campRealOrders.filter((o: any) => {
                const items = Array.isArray(o.items) ? o.items : [];
                const orderText = `${o.notes || ''} ${items.map((it: any) => `${it.title || ''} ${it.custom_notes || ''}`).join(' ')}`.toLowerCase();
                return matchedOccasionRegex.test(orderText);
            })
            : campRealOrders;

        const haloOrdersCount = Math.max(0, campRealOrders.length - directOrders.length);

        const formatVnDate = (d: Date): string => {
            return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        };
        const daysToStart = Math.round((winStart.getTime() - nowTime.getTime()) / 86400000);
        const windowLabel = isUpcoming
            ? `Kỳ ghi nhận: ${formatVnDate(winStart)} – ${formatVnDate(winEnd)} (Bắt đầu sau ${Math.max(1, daysToStart)} ngày)`
            : `Kỳ ghi nhận: ${formatVnDate(winStart)} – ${formatVnDate(winEnd)}`;

        const totalReal = campRealOrders.length;
        const campTotalGmv = campRealOrders.reduce((sum, o) => sum + getOrderAmount(o), 0);
        const windowDays = Math.max(7, Math.round((winEnd.getTime() - winStart.getTime()) / (1000 * 60 * 60 * 24)));

        // Nhịp nền lấy TRƯỚC kỳ dịp để mục tiêu không bị suy ra từ chính số đơn đem so
        const baseline = baselineDailyRate(shopRealOrders, winStart, RATE_WINDOW_DAYS);
        const shopDailyRate = baseline.rate;

        // Đo đạc lượt xem (views/clicks) và thêm giỏ hàng (add_to_cart) THẬT SỰ từ bảng product_events
        let realViewsCount = 0;
        let realCartAddsCount = 0;

        const shopProductObjectIds = shopProducts
            .map((p: any) => p._id)
            .filter((id: any) => mongoose.Types.ObjectId.isValid(id))
            .map((id: any) => new mongoose.Types.ObjectId(id));

        if (shopProductObjectIds.length > 0) {
            try {
                const eventAgg = await ProductEvent.aggregate([
                    {
                        $match: {
                            product_id: { $in: shopProductObjectIds },
                            created_at: { $gte: winStart, $lte: winEnd }
                        }
                    },
                    {
                        $group: {
                            _id: '$event_type',
                            total: { $sum: 1 }
                        }
                    }
                ]);
                for (const ev of eventAgg) {
                    if (ev._id === 'view') realViewsCount = ev.total;
                    if (ev._id === 'add_to_cart') realCartAddsCount = ev.total;
                }
            } catch {
                realViewsCount = 0;
                realCartAddsCount = 0;
            }
        }

        // 100% số đo THẬT từ product_events (`view`, `add_to_cart`) và bảng orders (`orders`)
        // Không chia ngược giả lập `impressions`, `views`, hay `add_to_cart` từ đơn hàng
        const actualOrders = totalReal;
        const actualAddCart = realCartAddsCount;
        const actualViews = realViewsCount;
        const actualReach: number | null = null;

        // Mức ngày thường = nhịp nền trước mùa × số ngày của kỳ dịp (chưa có số đo độ tăng ĐƠN của dịp nên không nhân hệ số)
        const targetOrders: number = computeTargetOrders(shopDailyRate, windowDays, 1) ?? 0;
        const targetBasis = {
            daily_rate: shopDailyRate != null ? Math.round(shopDailyRate * 100) / 100 : null,
            rate_window_days: RATE_WINDOW_DAYS,
            baseline_orders: baseline.orders,
            baseline_days: baseline.coverage_days,
            baseline_end: winStart.toISOString(),
            // khoảng nền trùng kỳ bán của dịp khác → nhịp "ngày thường" có thể bị đẩy cao
            baseline_overlaps: overlappingCampaigns(
                data.all_campaigns || [],
                new Date(winStart.getTime() - baseline.coverage_days * 86400000),
                winStart,
                activeCamp?.id,
            ),
            window_days: windowDays,
            uplift: null,
            uplift_source: null,
            search_uplift: uplift?.value ?? null,
            missing: baseline.missing,
        };

        // Kiểm tra chiến dịch đã phát sinh lưu lượng thật từ product_events hoặc đơn hàng chưa
        const hasActualTraffic = actualViews > 0 || actualAddCart > 0 || actualOrders > 0;

        const actualAov = actualOrders > 0
            ? Math.round(campTotalGmv / actualOrders)
            : (shopRealOrders.length > 0
                ? Math.round(shopRealOrders.reduce((sum, o) => sum + getOrderAmount(o), 0) / shopRealOrders.length)
                : 0);

        // Tỷ lệ chuyển đổi thực tế (null nếu mẫu bằng 0 — tuyệt đối không bịa)
        const realCtrPct: number | null = null;
        const realCartRatePct = actualViews > 0 ? Math.round((actualAddCart / actualViews) * 1000) / 10 : null;
        const realOrderRatePct = actualAddCart > 0 ? Math.round((actualOrders / actualAddCart) * 1000) / 10 : null;
        const realViewToOrderPct = actualViews > 0 ? Math.round((actualOrders / actualViews) * 1000) / 10 : null;

        // Mục tiêu tham chiếu cho các tầng có tracking (`view`, `add_to_cart`) chỉ tính khi đã có nhịp chuyển đổi thực tế
        const targetAddCart = (targetOrders > 0 && realOrderRatePct && realOrderRatePct > 0)
            ? Math.max(targetOrders, Math.round(targetOrders / (realOrderRatePct / 100)))
            : null;
        const targetViews = (targetAddCart && realCartRatePct && realCartRatePct > 0)
            ? Math.max(targetAddCart, Math.round(targetAddCart / (realCartRatePct / 100)))
            : null;

        const buildTier = (target: number | null, actual: number) => {
            const ratePercent = (target && target > 0) ? Math.min(100, Math.round((actual / target) * 100)) : 0;
            return {
                target: target ?? 0,
                actual,
                current_count: actual,
                current_uv: actual,
                current_pv: actual,
                rate_percent: ratePercent,
                baseline_rate_percent: 0,
                is_below_baseline: false
            };
        };

        const realDropoffCart = realCartRatePct !== null ? Math.max(0, Math.min(100, Math.round((100 - realCartRatePct) * 10) / 10)) : null;
        const realDropoffOrder = realOrderRatePct !== null ? Math.max(0, Math.min(100, Math.round((100 - realOrderRatePct) * 10) / 10)) : null;
        const abandonedCartsCount = Math.max(0, actualAddCart - actualOrders);

        // Khuyến nghị bóc tách theo ngành hàng thực tế của shop
        const sellerCatSlug = data.seller_category?.slug || '';
        let stage2Recommendation = 'Bổ sung hình ảnh sản phẩm cận cảnh thực tế, bảng thông số phân loại rõ ràng và chính sách đổi trả minh bạch để khách an tâm chốt giỏ.';
        if (sellerCatSlug === 'thoi-trang') {
            stage2Recommendation = 'Bổ sung bảng kích cỡ (size chart) chi tiết, ảnh chụp cận cảnh chất liệu vải và video mẫu mặc thực tế.';
        } else if (sellerCatSlug === 'sac-dep') {
            stage2Recommendation = 'Bổ sung bảng thành phần, hạn sử dụng, chứng nhận an toàn và video swatch màu/hướng dẫn sử dụng thực tế.';
        } else if (sellerCatSlug === 'dien-tu') {
            stage2Recommendation = 'Bổ sung thông số kỹ thuật chi tiết, video mở hộp (unbox), hướng dẫn kết nối và chính sách bảo hành chính hãng.';
        } else if (sellerCatSlug === 'nha-cua-doi-song') {
            stage2Recommendation = 'Bổ sung hình ảnh phối cảnh không gian thực tế, bảng kích thước chi tiết và hướng dẫn sử dụng/bảo quản.';
        } else if (sellerCatSlug === 'me-be') {
            stage2Recommendation = 'Bổ sung chứng nhận an toàn cho trẻ, chất liệu không độc hại, bảng kích cỡ độ tuổi và cam kết nguồn gốc chính hãng.';
        } else if (sellerCatSlug === 'bach-hoa') {
            stage2Recommendation = 'Bổ sung hạn sử dụng rõ ràng, chứng nhận ATVSTP, quy cách đóng gói và hình ảnh thật của sản phẩm.';
        } else if (sellerCatSlug === 'phu-kien') {
            stage2Recommendation = 'Bổ sung thông số kích thước chi tiết, chất liệu phụ kiện và hình ảnh đeo/phối đồ thực tế.';
        } else if (sellerCatSlug === 'the-thao') {
            stage2Recommendation = 'Bổ sung bảng hướng dẫn chọn size đồ tập, thông số chịu lực/chất liệu và video thử nghiệm độ bền vận động.';
        } else if (sellerCatSlug === 'van-phong-pham') {
            stage2Recommendation = 'Bổ sung định lượng giấy, chất liệu bìa, ảnh chụp trang sách/sổ và hình ảnh thực tế của ngòi bút.';
        } else if (sellerCatSlug === 'thu-cong-qua-tang') {
            stage2Recommendation = 'Bổ sung ảnh chụp cận cảnh độ tinh xảo thủ công, kích thước chi tiết và quy cách đóng gói sang trọng.';
        }

        const diagnostics = [
            {
                stage: 1,
                title: '1. Xem chi tiết ➔ Thêm giỏ',
                dropoff_rate_pct: realDropoffCart,
                target_rate_pct: null,
                badge_label: realCartRatePct !== null ? `Thêm giỏ ${realCartRatePct}%` : 'Chưa có lượt xem',
                metric_label: actualViews > 0
                    ? `Ghi nhận ${actualViews.toLocaleString('vi-VN')} lượt xem thực tế và ${actualAddCart.toLocaleString('vi-VN')} lượt thêm giỏ (tỷ lệ ${realCartRatePct}%).`
                    : `Chưa ghi nhận lượt xem sản phẩm nào trong cửa sổ dịp ${activeCamp?.name || 'mùa vụ'} (đo từ product_events).`,
                status: realCartRatePct === null ? 'warning' : (realCartRatePct >= 10 ? 'healthy' : 'critical'),
                ai_recommendation: stage2Recommendation
            },
            {
                stage: 2,
                title: '2. Thêm giỏ ➔ Chốt đơn',
                dropoff_rate_pct: realDropoffOrder,
                target_rate_pct: null,
                badge_label: realOrderRatePct !== null ? `Chốt đơn ${realOrderRatePct}%` : 'Chưa có giỏ hàng',
                metric_label: actualAddCart > 0
                    ? `Ghi nhận ${actualAddCart.toLocaleString('vi-VN')} lượt thêm giỏ và ${actualOrders.toLocaleString('vi-VN')} đơn hoàn tất (${abandonedCartsCount} giỏ chưa chốt, tỷ lệ ${realOrderRatePct}%).`
                    : `Chưa có lượt thêm giỏ hàng trong cửa sổ dịp ${activeCamp?.name || 'mùa vụ'}.`,
                abandoned_carts_count: abandonedCartsCount,
                status: realOrderRatePct === null ? 'warning' : (realOrderRatePct >= 25 ? 'healthy' : 'warning'),
                ai_recommendation: `Thiết lập mã ưu đãi hoặc freeship hợp lý trước hạn chốt giao an toàn để tăng tỷ lệ chốt giỏ.`
            }
        ];

        // 3 Kịch bản doanh thu chỉ hiển thị khi shop đã có AOV & mục tiêu đơn dựa trên đơn thật
        const targetGmv = (targetOrders > 0 && actualAov > 0) ? Math.round((targetOrders * actualAov) / 1000) * 1000 : 0;
        const breakthroughOrders = targetOrders > 0 ? Math.max(targetOrders + 2, Math.round(targetOrders * 1.3)) : 0;
        const breakthroughGmv = (breakthroughOrders > 0 && actualAov > 0) ? Math.round((breakthroughOrders * actualAov) / 1000) * 1000 : 0;
        const peakOrders = targetOrders > 0 ? Math.max(targetOrders + 5, Math.round(targetOrders * 1.6)) : 0;
        const peakGmv = (peakOrders > 0 && actualAov > 0) ? Math.round((peakOrders * actualAov) / 1000) * 1000 : 0;

        const scenarios = (targetOrders > 0 && actualAov > 0) ? [
            {
                key: 'baseline',
                name: 'Bằng ngày thường',
                orders: targetOrders,
                projected_gmv: targetGmv,
                formula_basis: `${targetOrders} đơn × ${actualAov.toLocaleString('vi-VN')}đ (AOV thực tế)`,
                condition_note: actualOrders >= targetOrders
                    ? `Đã hoàn thành ${actualOrders}/${targetOrders} đơn (${Math.round((actualOrders / targetOrders) * 100)}%)`
                    : `Đã đạt ${actualOrders}/${targetOrders} đơn (cần thêm ${targetOrders - actualOrders} đơn)`
            },
            {
                key: 'breakthrough',
                name: 'Hơn ngày thường 30%',
                orders: breakthroughOrders,
                growth_pct: 30,
                projected_gmv: breakthroughGmv,
                formula_basis: `${breakthroughOrders} đơn × ${actualAov.toLocaleString('vi-VN')}đ (AOV thực tế)`,
                condition_note: abandonedCartsCount > 0
                    ? `Chuyển đổi thêm từ ${abandonedCartsCount} giỏ hàng chưa chốt`
                    : `Tăng thêm ${breakthroughOrders - targetOrders} đơn so với mục tiêu cơ sở`
            },
            {
                key: 'peak',
                name: 'Hơn ngày thường 60%',
                orders: peakOrders,
                growth_pct: 60,
                projected_gmv: peakGmv,
                formula_basis: `${peakOrders} đơn × ${actualAov.toLocaleString('vi-VN')}đ (AOV thực tế)`,
                condition_note: `Kịch bản cao điểm khi tận dụng tốt chiến dịch sàn và tệp khách quen`
            }
        ] : [];

        const rawFunnel = data.campaign_funnel || {};
        data.campaign_funnel = {
            impressions: null,
            clicks: targetViews,
            views: targetViews,
            ctr_pct: null,
            ctr_vs_baseline_pct: null,
            cart_adds: targetAddCart,
            cart_rate_pct: realCartRatePct,
            orders: targetOrders,
            conversion_rate_pct: realOrderRatePct,
            view_to_order_pct: realViewToOrderPct,
            cvr_multiplier: null,
            real_ctr_pct: realCtrPct,
            real_cart_rate_pct: realCartRatePct,
            real_order_rate_pct: realOrderRatePct,
            real_view_to_order_pct: realViewToOrderPct,
            pv_uv_ratio: null,
            tracking_stages: ['view', 'add_to_cart', 'order'],
            actual: {
                orders: actualOrders,
                direct_orders: directOrders.length,
                halo_orders: haloOrdersCount,
                status_breakdown: campStatus,
                gmv_vnd: campTotalGmv,
                orders_progress_pct: targetOrders > 0 ? Math.min(100, Math.round((actualOrders / targetOrders) * 100)) : 0,
                remaining_orders: Math.max(0, targetOrders - actualOrders),
                impressions: actualReach,
                views: actualViews,
                clicks: actualViews,
                cart_adds: actualAddCart,
                window_label: windowLabel,
                window_start: winStart.toISOString().slice(0, 10),
                window_end: winEnd.toISOString().slice(0, 10)
            },
            reach: null,
            views_tier: buildTier(targetViews, actualViews),
            add_to_cart: buildTier(targetAddCart, actualAddCart),
            orders_tier: buildTier(targetOrders || null, actualOrders),
            target_basis: targetBasis,
            diagnostics,
            scenarios,
            aov: actualAov,
            target_gmv: targetGmv,
            forecast_method_info: data.forecast_method_info || rawFunnel.forecast_method_info,
            summary: {
                total_reach: null,
                total_views: actualViews,
                total_add_to_cart: actualAddCart,
                total_orders: actualOrders,
                total_gmv: campTotalGmv,
                conversion_rate: realViewToOrderPct ?? 0,
                aov: actualAov,
                active_campaign_name: activeCamp?.name || 'Chiến dịch mùa vụ',
                time_window_label: windowLabel
            }
        };

        // 3. Phân tích động lực mua sắm thực tế từ dữ liệu đơn hàng
        let giftCount = 0;
        let selfUseCount = 0;

        for (const o of campRealOrders) {
            let isGift = false;
            const note = (o.notes || '').toLowerCase();
            if (/tặng|quà|biếu|chúc|kỷ niệm|mừng/.test(note)) isGift = true;

            if (!isGift && Array.isArray(o.items)) {
                for (const it of o.items) {
                    const cNotes = (it.custom_notes || '').toLowerCase();
                    const iTitle = (it.title || it.name || '').toLowerCase();
                    if (/tặng|quà|biếu|thiệp|hộp quà|gift/.test(cNotes) || /set quà|hộp quà|combo quà/.test(iTitle)) {
                        isGift = true;
                        break;
                    }
                }
            }

            if (isGift) giftCount++;
            else selfUseCount++;
        }

        const totalClassified = giftCount + selfUseCount;
        if (totalClassified >= 3) {
            const liveGiftPct = Math.round((giftCount / totalClassified) * 100);
            const liveSelfPct = 100 - liveGiftPct;
            const sortedReasons = [
                { reason: 'Tự mua dùng', pct: liveSelfPct },
                { reason: 'Mua tặng', pct: liveGiftPct }
            ].sort((a, b) => b.pct - a.pct);

            data.motivation_breakdown = {
                gift_purchases_pct: liveGiftPct,
                self_purchases_pct: liveSelfPct,
                source_type: 'shop_actual',
                sample_size: totalClassified,
                source_description: `Bóc tách từ ${totalClassified} đơn thực tế (${giftCount} đơn quà tặng, ${selfUseCount} đơn tự dùng)`,
                top_reasons: sortedReasons
            };

            if (Array.isArray(data.purchase_reasons)) {
                data.purchase_reasons = [
                    { reason: 'Mua làm quà tặng', pct: liveGiftPct, count: giftCount },
                    { reason: 'Tự mua sử dụng', pct: liveSelfPct, count: selfUseCount }
                ];
            }
        } else {
            data.motivation_breakdown = {
                gift_purchases_pct: null,
                self_purchases_pct: null,
                source_type: 'insufficient',
                sample_size: totalClassified,
                source_description: `Chưa đủ 3 đơn thực tế trong dịp ${activeCamp?.name || 'mùa vụ'} (hiện có ${totalClassified} đơn) để phân loại mục đích mua.`,
                top_reasons: []
            };
        }

        // 3.2. Bóc tách và đồng bộ các kênh bán hàng chuẩn TMĐT (Channel Breakdown)
        const buyerOrderCountMap = new Map<string, number>();
        for (const o of shopRealOrders) {
            const bId = String(o.buyer_id || '');
            if (bId) {
                buyerOrderCountMap.set(bId, (buyerOrderCountMap.get(bId) || 0) + 1);
            }
        }

        const channelBuckets: Record<string, { orders: any[]; gmv: number; items: number; skus: Set<string> }> = {
            organic_listing: { orders: [], gmv: 0, items: 0, skus: new Set() },
            campaign_promo: { orders: [], gmv: 0, items: 0, skus: new Set() },
            direct_social: { orders: [], gmv: 0, items: 0, skus: new Set() },
            repeat_buyers: { orders: [], gmv: 0, items: 0, skus: new Set() },
        };

        for (const o of campRealOrders) {
            const bId = String(o.buyer_id || '');
            const couponDiscount = Number(o.financial_breakdown?.coupon_discount || 0);
            const note = `${o.notes || ''}`.toLowerCase();
            const oAmount = getOrderAmount(o);
            const oItems = Array.isArray(o.items) ? o.items : [];
            const itemCount = oItems.reduce((sum: number, it: any) => sum + (it.quantity || 1), 0);

            let assignedKey = 'organic_listing';

            // 1. Khách quen: Buyer đã từng có đơn hàng trước đó tại shop
            if (bId && (buyerOrderCountMap.get(bId) || 0) > 1) {
                assignedKey = 'repeat_buyers';
            }
            // 2. Kênh chiến dịch & Khuyến mãi: Đơn áp voucher hoặc có ghi chú khuyến mãi
            else if (couponDiscount > 0 || /voucher|khuyến mãi|sale|giảm giá|deal/.test(note)) {
                assignedKey = 'campaign_promo';
            }
            // 3. Liên kết ngoài & Mạng xã hội: Có ghi chú nguồn hoặc mã liên kết ngoài
            else if (/tiktok|facebook|fb|zalo|mạng xã hội|link ngoài|gioithieu/.test(note)) {
                assignedKey = 'direct_social';
            }
            // 4. Tìm kiếm tự nhiên trên sàn (SEO sàn): Các đơn còn lại
            else {
                assignedKey = 'organic_listing';
            }

            const bucket = channelBuckets[assignedKey];
            bucket.orders.push(o);
            bucket.gmv += oAmount;
            bucket.items += itemCount;
            for (const it of oItems) {
                if (it.product_id) bucket.skus.add(String(it.product_id));
            }
        }

        const CHANNEL_CONFIGS = [
            {
                key: 'organic_listing',
                name: 'Tìm kiếm & Khám phá tự nhiên (SEO sàn)',
                tip: 'Tối ưu ảnh concept và gắn bộ 5 thẻ tag ngách điểm cao.',
                rule: 'Khách tìm kiếm từ khóa trên sàn và bấm vào xem sản phẩm tự nhiên.',
                checklist: [
                    'Tối ưu ảnh bìa (cover) mang không khí mùa vụ để kích thích tỷ lệ nhấp (CTR).',
                    'Gắn 5 thẻ tag ngách điểm cao nhất theo gợi ý mùa vụ vào tiêu đề & mô tả.',
                    'Hoàn thiện bảng thông số kỹ thuật và video sản phẩm để tăng điểm chất lượng SEO sàn.'
                ],
                targetRatio: 0.45
            },
            {
                key: 'campaign_promo',
                name: 'Chiến dịch sàn & Khuyến mãi theo dịp',
                tip: 'Đăng ký tham gia sự kiện mùa lễ của sàn và thiết lập mã ưu đãi dịp cao điểm.',
                rule: 'Đơn hàng áp dụng voucher giảm giá hoặc phát sinh qua cổng chiến dịch sàn.',
                checklist: [
                    'Đăng ký tham gia cổng Flash Sale và Mega Sale của sàn trước hạn chốt an toàn.',
                    'Tạo mã giảm giá riêng của shop cho đơn đạt mức tối thiểu để kích thích chốt giỏ hàng.',
                    'Thiết lập Deal sốc hoặc Mua kèm deal sốc để tối ưu giá trị trung bình đơn (AOV).'
                ],
                targetRatio: 0.25
            },
            {
                key: 'direct_social',
                name: 'Liên kết ngoài & Mạng xã hội của shop',
                tip: 'Chia sẻ link bộ sưu tập lên Facebook, TikTok, Zalo để kéo khách về gian hàng.',
                rule: 'Khách truy cập từ liên kết chia sẻ bên ngoài sàn (Facebook, TikTok, Zalo) có gắn mã theo dõi.',
                checklist: [
                    'Đăng video unboxing/hướng dẫn chọn quà lên TikTok Reels kèm gắn link gian hàng.',
                    'Chia sẻ bộ sưu tập lên nhóm Zalo/Facebook khách hàng thân thiết để gom đơn sớm.',
                    'Gắn mã giới thiệu hoặc link rút gọn riêng để đo lường chính xác đơn từ mạng xã hội.'
                ],
                targetRatio: 0.15
            },
            {
                key: 'repeat_buyers',
                name: 'Khách quen quay lại đặt hàng theo dịp',
                tip: 'Gửi tin nhắn chăm sóc và voucher tri ân khách từng mua dịp trước.',
                rule: 'Khách hàng (buyer_id) đã từng có ít nhất 1 đơn hàng thành công trước đó tại shop.',
                checklist: [
                    'Gửi tin nhắn chăm sóc tự động kèm mã tri ân khách cũ nhân dịp lễ hội.',
                    'Gợi ý các mẫu quà tặng mới nhất phù hợp với sở thích mua sắm của khách.',
                    'Cảnh báo hạn chốt giao hàng sớm để khách quen đặt trước, tránh trễ hẹn mùa lễ.'
                ],
                targetRatio: 0.15
            }
        ];

        if (totalReal > 0) {
            // Trường hợp có đơn thực tế: Phân bổ 100% trung thực từ đơn hàng đối soát
            data.channel_breakdown = CHANNEL_CONFIGS.map(cfg => {
                const b = channelBuckets[cfg.key];
                const count = b.orders.length;
                const sharePct = Math.round((count / totalReal) * 1000) / 10;
                const aov = count > 0 ? Math.round(b.gmv / count) : 0;
                return {
                    channel_key: cfg.key,
                    name: cfg.name,
                    share_pct: sharePct,
                    gmv_vnd: b.gmv,
                    orders_count: count,
                    sku_orders: b.skus.size || count,
                    items_sold: b.items,
                    aov_vnd: aov,
                    growth_pct: null,
                    action_tip: cfg.tip,
                    source_type: 'shop_actual',
                    is_target_plan: false,
                    criteria_rule: cfg.rule,
                    action_checklist: cfg.checklist,
                    sample_orders: b.orders.slice(0, 4).map(o => ({
                        order_code: o.order_code,
                        total_amount: getOrderAmount(o),
                        item_summary: Array.isArray(o.items) ? o.items.map((it: any) => it.title || it.name).join(', ') : 'Sản phẩm',
                        attribution_reason: cfg.rule
                    }))
                };
            });
        } else {
            // Trường hợp chưa phát sinh đơn: Không bịa tỷ trọng 45/25/15/15% hay GMV giả — trả 0 kèm checklist chuẩn bị
            data.channel_breakdown = CHANNEL_CONFIGS.map(cfg => ({
                channel_key: cfg.key,
                name: cfg.name,
                share_pct: 0,
                gmv_vnd: 0,
                orders_count: 0,
                sku_orders: 0,
                items_sold: 0,
                aov_vnd: 0,
                growth_pct: null,
                action_tip: cfg.tip,
                source_type: 'insufficient',
                is_target_plan: true,
                criteria_rule: cfg.rule,
                action_checklist: cfg.checklist
            }));
        }

        // Kế hoạch mùa vụ theo kỳ (dịp + năm) từ seasonal_plans. Shop demo dùng chung: không có kế hoạch riêng.
        const seasonalPrefs = (shopDoc as any)?.settings?.seasonal_preferences;
        const planShopId = writableShopId(viewer);
        const plansByKey = new Map<string, any>();
        if (planShopId) {
            const plans = await SeasonalPlan.find({
                shop_id: new mongoose.Types.ObjectId(planShopId),
                event_year: { $gte: new Date().getFullYear() - 1 },
            }).lean().catch(() => [] as any[]);
            for (const pl of plans) plansByKey.set(planLookupKey(pl.event_key, pl.event_year), pl);
        }
        const legacyPrefs = planShopId ? seasonalPrefs : null;
        const activeCampId: string = data.active_campaign?.id || '';
        const planEventYear = eventYearOf(data.active_campaign);
        const activePlan = planViewFor(plansByKey, activeCampId, planEventYear, legacyPrefs);
        const savedIdeas: string[] = activePlan.saved_ideas;

        // Mốc đã tick của mọi dịp trong lịch, mỗi dịp lấy đúng kỳ (năm) của nó; khóa giữ dạng FE đang dùng `${camp}_${...}`
        const checkedMilestones: Record<string, boolean> = {};
        for (const camp of (data.all_campaigns || []) as any[]) {
            const view = planViewFor(plansByKey, camp.id, eventYearOf(camp), null);
            for (const [k, v] of Object.entries(view.checked_milestones)) checkedMilestones[`${camp.id}_${k}`] = Boolean(v);
        }
        // Dịp đang xem: thêm khóa không tiền tố (`${idea}_${idx}`, `${idx}`) mà thẻ Áp dụng đang đọc
        Object.assign(checkedMilestones, activePlan.checked_milestones);
        data.saved_ideas = savedIdeas;
        data.checked_milestones = checkedMilestones;
        data.saved_idea_drafts = activePlan.idea_drafts;
        data.occasion_reviews = activePlan.review ? { [activeCampId]: activePlan.review } : {};
        data.plan = { event_key: activeCampId, event_year: planEventYear, source: activePlan.source };

        // Phân tích Shop DNA (phong cách & khung giá thật từ sản phẩm của shop) để scope chặt cho LLM sinh ý tưởng
        const tagFreq: Record<string, number> = {};
        const shopPrices: number[] = [];
        const shopSampleTitles: string[] = [];
        for (const p of shopProducts) {
            if (p.title) shopSampleTitles.push(String(p.title));
            if (Number(p.original_price) >= 30000) shopPrices.push(Number(p.original_price));
            if (Array.isArray(p.tags)) {
                for (const tg of p.tags) {
                    const clean = String(tg || '').trim().toLowerCase();
                    if (clean) tagFreq[clean] = (tagFreq[clean] || 0) + 1;
                }
            }
        }
        const shopStyleKeywords = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 6);
        const minP = shopPrices.length > 0 ? Math.min(...shopPrices) : 150000;
        const maxP = shopPrices.length > 0 ? Math.max(...shopPrices) : 450000;
        const avgP = shopPrices.length > 0 ? Math.round(shopPrices.reduce((s, x) => s + x, 0) / shopPrices.length) : 260000;
        data.shop_dna = {
            style_keywords: shopStyleKeywords,
            sample_titles: shopSampleTitles.slice(0, 5),
            price_band: { min: minP, max: maxP, avg: avgP },
            product_count: shopProducts.length,
        };

        // 4. ĐỘNG CƠ SINH LỜI KHUYÊN HÀNH ĐỘNG ĐỘNG (GEMINI AI TRỰC TIẾP + FALLBACK DỰ PHÒNG)
        const activeTraits: any[] = data.active_campaign?.occasion_traits || data.occasion_traits || [];
        const traitByKey: Record<string, any> = {};
        for (const t of activeTraits) traitByKey[t.key] = t;

        const fmtShortVn = (d: Date | null) =>
            d && !Number.isNaN(d.getTime())
                ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
                : '';
        const peakDt = data.active_campaign?.launch_window?.peak_date
            ? new Date(data.active_campaign.launch_window.peak_date)
            : data.active_campaign?.event_date
            ? new Date(data.active_campaign.event_date)
            : null;
        const earlyD = typeof (traitByKey.earlyOrder?.industryValue ?? traitByKey.earlyOrder?.baselineValue) === 'number'
            ? Math.round(traitByKey.earlyOrder.industryValue ?? traitByKey.earlyOrder.baselineValue)
            : 15;
        const earlyDt = peakDt ? new Date(peakDt.getTime() - earlyD * 86400000) : null;
        const peakStartDt = peakDt ? new Date(peakDt.getTime() - 2 * 86400000) : null;

        const traitActionsPromise = data.active_campaign && activeTraits.length > 0
            ? SeasonalAnalyticsService.fetchGeminiTraitActions({
                campId: data.active_campaign.id || 'event',
                campName: data.active_campaign.name || 'Dịp cao điểm',
                catName: data.seller_category?.name || 'Thời trang & Phụ kiện',
                primaryKw: data.primary_keyword || data.active_campaign.search_keywords?.[0] || 'quà tặng',
                earlyDateStr: fmtShortVn(earlyDt) || 'sớm',
                peak3DaysStr: peakStartDt && peakDt ? `${fmtShortVn(peakStartDt)}–${fmtShortVn(peakDt)}` : '3 ngày cao điểm',
                ordersGrowth: traitByKey.ordersGrowth?.industryValue ?? traitByKey.ordersGrowth?.baselineValue,
                spendingGrowth: traitByKey.higherSpending?.industryValue ?? traitByKey.higherSpending?.baselineValue,
                earlyDays: earlyD,
                peakShop: traitByKey.peakClustering?.shopValue,
                peakInd: traitByKey.peakClustering?.industryValue ?? traitByKey.peakClustering?.baselineValue,
                comboShop: traitByKey.comboPurchase?.shopValue,
                comboInd: traitByKey.comboPurchase?.industryValue ?? traitByKey.comboPurchase?.baselineValue,
                voucherShop: traitByKey.voucherSensitivity?.shopValue,
                voucherInd: traitByKey.voucherSensitivity?.industryValue ?? traitByKey.voucherSensitivity?.baselineValue,
            })
            : Promise.resolve(null);

        const aiBlueprint = data.idea_draft_blueprint;
        const bpStyleKws: string[] = Array.isArray(aiBlueprint?.shop_dna?.style_keywords) && aiBlueprint.shop_dna.style_keywords.length > 0
            ? aiBlueprint.shop_dna.style_keywords
            : shopStyleKeywords;
        const bpTitles: string[] = Array.isArray(aiBlueprint?.shop_dna?.sample_titles) && aiBlueprint.shop_dna.sample_titles.length > 0
            ? aiBlueprint.shop_dna.sample_titles
            : shopSampleTitles;
        const bpPriceBand = aiBlueprint?.shop_dna?.price_band || { min: minP, max: maxP, avg: avgP };
        const bpOppKeywords = Array.isArray(aiBlueprint?.top_opportunity_keywords) && aiBlueprint.top_opportunity_keywords.length > 0
            ? aiBlueprint.top_opportunity_keywords
            : (Array.isArray(data.opportunity_keywords)
                ? data.opportunity_keywords.slice(0, 5).map((k: any) => ({
                    tag: k.tag,
                    volume: Number(k.search_volume || 0),
                    competition: Number(k.competition || 0),
                    wow: k.search_wow_pct ?? null,
                }))
                : []);

        // Gắn `source_idea_id` thật từ MongoDB vào `data.shop_products` để Tab Áp dụng khớp chính xác 100%
        if (Array.isArray(data.shop_products) && shopProducts.length > 0) {
            const ideaByProdId = new Map<string, string>();
            for (const sp of shopProducts) {
                if (sp._id && sp.source_idea_id) {
                    ideaByProdId.set(String(sp._id), String(sp.source_idea_id));
                }
            }
            for (const dp of data.shop_products) {
                const pid = String(dp._id || dp.id || '');
                if (pid && !dp.source_idea_id && ideaByProdId.has(pid)) {
                    dp.source_idea_id = ideaByProdId.get(pid);
                }
            }
        }

        const activeCampIdForGen = data.active_campaign?.id || 'event';
        const activeEventYear = peakDt && !Number.isNaN(peakDt.getTime()) ? peakDt.getFullYear() : new Date().getFullYear();
        const safeGenCampKey = `${String(activeCampIdForGen).replace(/[^a-zA-Z0-9_-]/g, '_')}_${activeEventYear}`;
        const persistedEntry = seasonalPrefs?.generated_ideas?.[safeGenCampKey];
        const persistedIdeas: ShopSeasonalIdea[] | null =
            Array.isArray(persistedEntry?.ideas) && persistedEntry.ideas.length > 0
                ? persistedEntry.ideas
                : null;

        const aiIdeasPromise = data.active_campaign
            ? SeasonalAnalyticsService.fetchGeminiSeasonalIdeas({
                shopId: viewer.live_shop_id || viewer.analysed_shop_id || 'default',
                liveShopOid,
                shopName: viewer.shop_name || 'Gian hàng của bạn',
                catName: data.seller_category?.name || 'Thời trang & Phụ kiện',
                campId: activeCampIdForGen,
                campName: data.active_campaign.name || 'Dịp cao điểm',
                eventYear: activeEventYear,
                persistedIdeas,
                shopStyleKeywords: bpStyleKws,
                shopSampleTitles: bpTitles,
                priceBand: bpPriceBand,
                topOppKeywords: bpOppKeywords,
                ordersGrowth: aiBlueprint?.dl_and_stl_signals?.orders_growth_pct ?? traitByKey.ordersGrowth?.industryValue ?? traitByKey.ordersGrowth?.baselineValue,
                spendingGrowth: aiBlueprint?.dl_and_stl_signals?.spending_growth_pct ?? traitByKey.higherSpending?.industryValue ?? traitByKey.higherSpending?.baselineValue,
                comboInd: aiBlueprint?.dl_and_stl_signals?.combo_pct ?? traitByKey.comboPurchase?.industryValue ?? traitByKey.comboPurchase?.baselineValue,
                occasionIndustryClusters: aiBlueprint?.occasion_industry_benchmarks?.top_selling_clusters || [],
                occasionIndustryPriceBand: aiBlueprint?.occasion_industry_benchmarks?.price_band,
                industryScale: aiBlueprint?.market_scale,
            })
            : Promise.resolve([]);

        if (Array.isArray(data.all_campaigns)) {
            await Promise.all(data.all_campaigns.map(async (camp: any) => {
                const kw = camp.search_keywords?.[0] || 'sản phẩm đón dịp';
                const campName = camp.name || 'Dịp cao điểm';
                const daysToCutoff = Number(camp.timing?.days_diff ?? camp.occasion_window?.days_to_cutoff ?? 7);
                const daysToEvent = Number(camp.timing?.days_to_event ?? 15);
                const isUrgent = daysToCutoff <= 3;
                const currentPhase = camp.timing?.current_phase || (isUrgent ? 'cutoff' : (daysToEvent <= 10 ? 'traction' : 'prep'));
                // Sát lễ / sau lễ: giữ nguyên gợi ý theo pha do AI tính (bán hàng có sẵn, giao nhanh / xem kết quả)
                if (currentPhase === 'last_call' || currentPhase === 'post_event') return;

                const tracStart = camp.launch_window?.traction_start ? new Date(camp.launch_window.traction_start) : null;
                const cutEnd = camp.launch_window?.end ? vnDayEnd(String(camp.launch_window.end).slice(0, 10)) : null;
                const rdStart = camp.launch_window?.start ? vnDayStart(String(camp.launch_window.start).slice(0, 10)) : null;
                const evDate = camp.event_date ? new Date(camp.event_date) : (camp.occasion_window?.event_date ? new Date(camp.occasion_window.event_date) : null);

                const tracStr = tracStart ? formatVnDate(tracStart) : '';
                const cutStr = cutEnd ? formatVnDate(cutEnd) : '';
                const rdStr = rdStart ? formatVnDate(rdStart) : (tracStart ? formatVnDate(new Date(tracStart.getTime() - 14 * 86400000)) : '');
                const evStr = evDate ? formatVnDate(evDate) : (cutEnd ? formatVnDate(new Date(cutEnd.getTime() + 10 * 86400000)) : 'ngày sự kiện');

                const matchedProds: any[] = (camp.matching_shop_products && camp.matching_shop_products.length > 0)
                    ? camp.matching_shop_products
                    : (shopProducts || []).filter((p: any) => {
                        const pTitle = (p.title || '').toLowerCase();
                        const pTags: string[] = (p.tags || []).map((t: string) => t.toLowerCase());
                        const kwLower = kw.toLowerCase();
                        return pTitle.includes(kwLower) || pTags.some(t => t.includes(kwLower) || kwLower.includes(t));
                    });

                const matchCount = matchedProds.length;
                const firstMatchedTitle = matchCount > 0 ? matchedProds[0].title : '';
                const totalStock = matchedProds.reduce((sum, p) => sum + (Number(p.stock) || 0), 0);

                // Cùng kỳ đo với phễu: từ ngày mở bán; dịp chưa có lịch thì không đếm
                const campStartStr = camp.launch_window?.traction_start || camp.launch_window?.start;
                const campOrdersCount = campStartStr
                    ? ordersInWindow(shopRealOrders || [], vnDayStart(String(campStartStr).slice(0, 10)), cutEnd || new Date()).length
                    : 0;

                const isCurrentActive = camp.id === (data.active_campaign?.id || '');
                const campSavedCount = isCurrentActive
                    ? savedIdeas.length
                    : planViewFor(plansByKey, camp.id, eventYearOf(camp), null).saved_ideas.length;

                const evYear = evDate ? evDate.getFullYear() : (tracStart ? tracStart.getFullYear() : new Date().getFullYear());
                const catSlug = detectedSlug || 'tong-hop';
                const catName = detectedName || 'Ngành hàng của shop';
                // Độ nâng lượt tìm kiếm chỉ đo cho dịp đang xem; không gán cho các dịp khác
                const growthPct: number | null =
                    camp.id === (data.active_campaign?.id || '') && searchUpliftPct != null
                        ? searchUpliftPct
                        : null;

                const categorySuggestions: Record<string, { winterItem: string; noelGift: string; tetSpecial: string }> = {
                    'thoi-trang': {
                        winterItem: 'combo áo ấm mùa đông hoặc deal mua kèm nhiều món',
                        noelGift: 'set áo len Noel, áo cặp họa tiết Giáng Sinh',
                        tetSpecial: `áo dài cách tân & dải sản phẩm đồ mặc gia đình đón Tết ${evYear}`
                    },
                    'sac-dep': {
                        winterItem: 'combo dưỡng ẩm mùa đông hoặc son kem lì',
                        noelGift: 'set mỹ phẩm chăm sóc da Giáng Sinh',
                        tetSpecial: `combo chăm sóc da & trang điểm rạng rỡ đón Tết ${evYear}`
                    },
                    'dien-tu': {
                        winterItem: 'deal tai nghe bluetooth hoặc pin sạc dự phòng',
                        noelGift: 'phụ kiện công nghệ hoặc loa mini quà tặng',
                        tetSpecial: `combo củ cáp sạc nhanh & phụ kiện nâng cấp đón Tết ${evYear}`
                    },
                    'nha-cua-doi-song': {
                        winterItem: 'đèn sưởi, bình giữ nhiệt hoặc chăn ga mùa đông',
                        noelGift: 'đèn ngủ thông minh hoặc nến thơm Giáng Sinh',
                        tetSpecial: `khay mứt Tết, bộ ấm chén tiếp khách & đồ trang hoàng đón Tết ${evYear}`
                    },
                    'me-be': {
                        winterItem: 'bộ nỉ ấm cho bé hoặc bình giữ nhiệt giữ ấm',
                        noelGift: 'set đồ chơi quà tặng Giáng Sinh cho bé',
                        tetSpecial: `bộ quần áo Tết cho bé & áo dài trẻ em đón Tết ${evYear}`
                    },
                    'bach-hoa': {
                        winterItem: 'trà thảo mộc, hạt dinh dưỡng mùa đông',
                        noelGift: 'hộp bánh kẹo Giáng Sinh & sô-cô-la',
                        tetSpecial: `giỏ quà Tết bách hóa, hạt dưa & trà mứt đón Tết ${evYear}`
                    },
                    'the-thao': {
                        winterItem: 'bộ đồ tập giữ nhiệt hoặc bình nước thể thao',
                        noelGift: 'balo du lịch hoặc phụ kiện thể thao quà tặng',
                        tetSpecial: `combo trang phục thể thao & phụ kiện dã ngoại du xuân ${evYear}`
                    },
                    'van-phong-pham': {
                        winterItem: 'sổ tay kế hoạch năm mới & bút ký cao cấp',
                        noelGift: 'set sổ quà tặng & thiệp Noel trang nhã',
                        tetSpecial: `lịch năm mới, bao lì xì & sổ kế hoạch đón Tết ${evYear}`
                    },
                    'phu-kien': {
                        winterItem: 'combo khăn choàng cổ, găng tay & mũ len',
                        noelGift: 'set trang sức lấp lánh & ví thời trang Giáng Sinh',
                        tetSpecial: `túi xách tài lộc & phụ kiện may mắn đón Tết ${evYear}`
                    },
                    'thu-cong-qua-tang': {
                        winterItem: 'combo sản phẩm thủ công decor ấm áp',
                        noelGift: 'set quà tặng Giáng Sinh thủ công độc bản',
                        tetSpecial: `liễn thư pháp, tranh treo tường & hộp quà đón Tết ${evYear}`
                    }
                };
                const catSugg = categorySuggestions[catSlug] || {
                    winterItem: `combo sản phẩm bán chạy mùa đông từ nhóm "${kw}"`,
                    noelGift: `set sản phẩm Giáng Sinh từ nhóm "${kw}"`,
                    tetSpecial: `sản phẩm chủ lực đón xuân ${evYear}`
                };

                const campKey = (camp.id || '').toLowerCase();

                let recTitle = '';
                let recAdvice = '';
                let ctaLabel = 'Xem gợi ý sản phẩm đón dịp';
                let targetTab = 'potential';
                let actionType = 'prepare_inventory';
                let badgeText = camp.timing?.label || 'Chuẩn bị';
                let badgeVariant: 'emerald' | 'blue' | 'amber' = 'emerald';

                if (isUrgent) {
                    badgeVariant = 'amber';
                    actionType = 'close_orders';
                    ctaLabel = 'Kiểm tra tồn kho & đóng gói';
                    targetTab = 'readiness';
                    badgeText = daysToCutoff <= 1 ? 'Hạn chốt 1 ngày' : `Hạn chốt còn ${daysToCutoff} ngày`;
                } else if (currentPhase === 'traction' || (tracStart && new Date() >= tracStart)) {
                    badgeVariant = 'blue';
                    actionType = 'boost_traffic';
                    ctaLabel = 'Xem xu hướng & sức mua';
                    targetTab = 'traits';
                    badgeText = 'Mở bán & gom đơn';
                } else {
                    badgeVariant = 'emerald';
                    actionType = 'prepare_inventory';
                    ctaLabel = 'Xem gợi ý sản phẩm đón dịp';
                    targetTab = 'potential';
                    const daysToTrac = tracStart ? Math.max(0, Math.round((tracStart.getTime() - new Date().getTime()) / 86400000)) : 10;
                    badgeText = daysToTrac <= 0 ? 'Chuẩn bị nguồn hàng' : `Bắt đầu sau ${daysToTrac} ngày`;
                }

                // 1. GỌI TRỰC TIẾP GEMINI AI NẾU CÓ KEY (Chỉ gọi cho dịp đang chọn để tiết kiệm quota)
                const isTargetCamp = camp.id === (data.active_campaign?.id || '');
                const geminiRec = isTargetCamp ? await SeasonalAnalyticsService.fetchGeminiSeasonalAdvisory({
                    campName,
                    eventYear: evYear,
                    catName,
                    kw,
                    growthPct,
                    matchCount,
                    firstMatchedTitle,
                    totalStock,
                    campSavedCount,
                    campOrdersCount,
                    currentPhase,
                    isUrgent,
                    daysToCutoff,
                    tracStr,
                    cutStr,
                    evStr
                }) : null;

                if (geminiRec) {
                    recTitle = geminiRec.title;
                    recAdvice = geminiRec.advice;
                } else if (isUrgent) {
                    const growthPhrase = growthPct !== null ? ` Lượt tìm kiếm dịp ${campName} thường ${growthPct >= 0 ? 'tăng' : 'giảm'} ${Math.abs(growthPct)}% so với ngày thường.` : '';
                    if (campKey.includes('tet')) {
                        recTitle = `Khóa nhận đơn Tết ${evYear}, xả toàn bộ hàng sẵn`;
                        recAdvice = `Chỉ còn ${daysToCutoff} ngày đến hạn chốt an toàn (${cutStr}). Bưu cục bắt đầu quá tải và xưởng nghỉ Tết sớm; tắt ngay phân loại đặt trước, dồn toàn lực đóng gói ${matchCount > 0 ? `${matchCount} mẫu có sẵn` : 'toàn bộ đơn hàng'} để kịp bàn giao trước hạn chốt.`;
                    } else if (campKey.includes('noel') || campKey.includes('giang-sinh')) {
                        recTitle = `Chốt đơn quà Noel, ưu tiên hàng sẵn kho`;
                        recAdvice = `Hạn chốt an toàn còn ${daysToCutoff} ngày (${cutStr}). Khách mua Noel cần nhận trước đêm lễ; ngừng nhận đơn xa/đơn làm riêng, tập trung kiểm kê ${matchCount > 0 ? `${matchCount} mẫu sẵn kho` : 'hàng có sẵn'} kèm thiệp chúc để bàn giao bưu cục ngay.`;
                    } else if (campKey.includes('12/12') || campKey.includes('11/11')) {
                        recTitle = `Dừng nhận đơn đặt trước, chốt tồn kho ${campName}`;
                        recAdvice = `Hạn chốt an toàn còn ${daysToCutoff} ngày (${cutStr}). Tắt phân loại hàng đặt làm theo yêu cầu, khóa kho và dồn nhân lực đóng gói ${matchCount > 0 ? `${matchCount} mẫu sẵn kho (tồn ${totalStock} cái)` : 'hàng sẵn'} để kịp bàn giao bưu cục, tránh giao trễ.`;
                    } else {
                        recTitle = `Tắt nhận đặt trước, dồn lực đóng gói giao hàng`;
                        recAdvice = `Hạn chốt an toàn còn ${daysToCutoff} ngày (${cutStr}). Tắt ngay phân loại hàng đặt làm theo yêu cầu, khóa tồn kho và dồn nhân lực đóng gói ${matchCount > 0 ? `${matchCount} mẫu có sẵn` : 'toàn bộ đơn hàng'} để bàn giao bưu cục kịp trước ${evStr}.`;
                    }
                } else if (currentPhase === 'traction' || (tracStart && new Date() >= tracStart)) {
                    if (campOrdersCount > 0) {
                        recTitle = `Đã có ${campOrdersCount} đơn · Bật Deal Sốc kéo AOV`;
                        recAdvice = `Sản phẩm đang có đơn tốt (${campOrdersCount} đơn). Bật ngay tính năng Mua Kèm Deal Sốc hoặc gói combo mua nhiều món trên sàn để tăng giá trị đơn trung bình trong mùa ${campName} ${evYear}.`;
                    } else if (matchCount > 0) {
                        if (campKey.includes('12/12') || campKey.includes('11/11')) {
                            recTitle = `Cài voucher shop & Rà soát giá cho ${matchCount} mẫu`;
                            recAdvice = `Đã mở bán nhưng ${matchCount} mẫu ("${firstMatchedTitle}") chưa phát sinh đơn. Khách săn sale ${campName} ${evYear} thường so sánh giá rất kỹ; hãy cài voucher theo ngưỡng đơn của shop và rà lại giá so với top bán chạy sàn.`;
                        } else if (campKey.includes('noel') || campKey.includes('giang-sinh')) {
                            recTitle = `Đổi ảnh concept quà tặng Noel cho ${matchCount} mẫu`;
                            recAdvice = `Đã có ${matchCount} mẫu nhưng chưa phát sinh đơn. Thay ngay ảnh đại diện thành concept hộp quà và gắn từ khóa "quà tặng Noel" vào đầu tiêu đề để hút khách mua tặng.`;
                        } else if (campKey.includes('tet')) {
                            recTitle = `Kích hoạt ưu đãi "Sắm Tết sớm" cho ${matchCount} mẫu`;
                            recAdvice = `Tâm lý khách sắm Tết ${evYear} muốn nhận sớm để chủ động thời gian. Cài đặt ưu đãi đặt sớm cho ${matchCount} mẫu ("${firstMatchedTitle}") để gom đơn trước khi thị trường bước vào tuần quá tải vận chuyển.`;
                        } else {
                            recTitle = `Rà soát giá & Bổ sung video thật cho ${matchCount} mẫu`;
                            recAdvice = `Mẫu "${firstMatchedTitle}" chưa phát sinh đơn. Bổ sung ngay video quay thật cận chất liệu và thêm mã giảm giá giới hạn để kích hoạt những đơn hàng đầu tiên.`;
                        }
                    } else {
                        recTitle = `Đăng bán sản phẩm để bot sàn index từ khóa`;
                        recAdvice = `Nhu cầu tìm "${kw}" dịp ${campName} ${evYear} đang tăng tốc. Đăng ngay sản phẩm sẵn có để bot sàn kịp nhận diện từ khóa trước tuần lễ cao điểm.`;
                    }
                } else {
                    const growthPhrase = growthPct !== null ? ` Lượt tìm kiếm dịp ${campName} thường ${growthPct >= 0 ? 'tăng' : 'giảm'} ${Math.abs(growthPct)}% so với ngày thường.` : '';
                    if (campKey.includes('12/12') || campKey.includes('11/11')) {
                        if (matchCount > 0) {
                            recTitle = `Lên gói combo & deal mua kèm cho ${matchCount} mẫu sẵn có`;
                            recAdvice = `Shop đã có ${matchCount} mẫu ("${firstMatchedTitle}").${growthPhrase} Hãy đóng gói combo hoặc deal mua kèm ${catSugg.winterItem} để tăng giá trị đơn trước ngày mở bán (${tracStr}).`;
                        } else if (campSavedCount > 0) {
                            recTitle = `Chuẩn bị hàng mẫu đã lưu trước ngày mở bán (${tracStr})`;
                            recAdvice = `Shop đã lưu ${campSavedCount} mẫu ý tưởng đón ${campName}. Tập trung chọn 1 mẫu chủ lực về ${catSugg.winterItem} để chuẩn bị hàng hóa và đăng ký sự kiện sàn trước (${tracStr}), tránh thử nghiệm dàn trải làm đọng vốn.`;
                        } else {
                            recTitle = `Gom combo đón đợt sale ${campName} ${evYear}`;
                            recAdvice = `${growthPhrase || `Đợt sale ${campName} ${evYear} sắp mở bán.`} Gom nhanh các mặt hàng hiện có thành ${catSugg.winterItem} trước ngày mở bán (${tracStr}) để đón đầu lượng tìm kiếm.`;
                        }
                    } else if (campKey.includes('noel') || campKey.includes('giang-sinh')) {
                        if (matchCount > 0) {
                            recTitle = `Thêm tùy chọn Hộp quà & Thiệp Giáng Sinh cho ${matchCount} mẫu`;
                            recAdvice = `Đã có ${matchCount} mẫu ("${firstMatchedTitle}"). Nhiều khách Noel có nhu cầu tặng quà; tạo ngay tùy chọn đóng hộp quà và thiệp chúc mừng trực tiếp trên link sản phẩm trước ngày mở bán (${tracStr}) để gia tăng giá trị đơn hàng.`;
                        } else if (campSavedCount > 0) {
                            recTitle = `Triển khai sản phẩm Noel đã lưu trước ngày (${tracStr})`;
                            recAdvice = `Đã lưu ${campSavedCount} ý tưởng Noel. Chuẩn bị nguồn hàng cho ${catSugg.noelGift} và chụp ảnh concept bắt mắt trước ngày mở bán (${tracStr}) để đón tệp khách mua sớm.`;
                        } else {
                            recTitle = `Lên sản phẩm đón Giáng Sinh trước ngày (${tracStr})`;
                            recAdvice = `Chuẩn bị nguồn hàng ${catSugg.noelGift} trước (${tracStr}) để đón lượng tìm kiếm đang tăng vọt trên sàn.`;
                        }
                    } else if (campKey.includes('tet')) {
                        if (matchCount > 0) {
                            recTitle = `Chốt nguồn hàng Tết ${evYear} & Khóa hạn giao an toàn`;
                            recAdvice = `Đã có ${matchCount} mẫu Tết ("${firstMatchedTitle}"). Cận Tết ${evYear} các đơn vị vận chuyển và nhà cung ứng thường quá tải và nghỉ Tết sớm; cần chốt lượng hàng dự phòng cho ${catSugg.tetSpecial} trước ngày mở bán (${tracStr}) để tránh đứt hàng.`;
                        } else if (campSavedCount > 0) {
                            recTitle = `Chuẩn bị tồn kho sớm cho mẫu Tết ${evYear} đã lưu`;
                            recAdvice = `Đã lưu ${campSavedCount} ý tưởng Tết. Nhập hàng và chuẩn bị tồn kho sớm cho mẫu ${catSugg.tetSpecial} trước ngày mở bán (${tracStr}) để đón đầu lượng tìm kiếm sắm Tết và tránh chi phí nhập hàng tăng cao cận Tết.`;
                        } else {
                            recTitle = `Chuẩn bị dải hàng Tết ${evYear} đón sức mua`;
                            recAdvice = `Mùa Tết có nhu cầu mua sắm lớn nhất năm. Cần lên dải hàng ${catSugg.tetSpecial} trước (${tracStr}) để sẵn sàng hàng hóa và tối ưu trang sản phẩm đón Tết.`;
                        }
                    } else if (campKey.includes('valentine')) {
                        if (matchCount > 0) {
                            recTitle = `Thêm tùy chọn Khắc tên & Thiệp tình nhân cho ${matchCount} mẫu`;
                            recAdvice = `Đã có ${matchCount} mẫu. Khách Valentine chuộng tính cá nhân hóa; hãy thêm tùy chọn in/khắc tên kỷ niệm và đóng gói trang nhã trước ngày mở bán (${tracStr}).`;
                        } else {
                            recTitle = `Lên sản phẩm cặp đôi & Đóng gói quà đón Valentine`;
                            recAdvice = `Chuẩn bị các sản phẩm cặp đôi hoặc quà tặng phù hợp ngành ${catName} kèm dịch vụ viết thiệp trước (${tracStr}) để kịp thời gian giao hàng đúng ngày 14/2.`;
                        }
                    } else if (campKey.includes('8/3') || campKey.includes('20/10')) {
                        if (matchCount > 0) {
                            recTitle = `Đóng gói set quà kèm thiệp tri ân cho ${matchCount} mẫu`;
                            recAdvice = `Đã có ${matchCount} mẫu. Bổ sung tùy chọn đóng gói trang nhã và thiệp tri ân phái đẹp trước (${tracStr}) để khách dễ dàng chọn mua làm quà.`;
                        } else {
                            recTitle = `Chuẩn bị sản phẩm quà tặng đón dịp tri ân phái đẹp`;
                            recAdvice = `Ưu tiên các mẫu sản phẩm ngành ${catName} dễ tặng và thông dụng, chuẩn bị bao bì lịch sự trước ngày mở bán (${tracStr}) để tối ưu tỷ lệ chốt đơn.`;
                        }
                    } else if (campKey.includes('20/11')) {
                        if (matchCount > 0) {
                            recTitle = `Đóng gói trang trọng & Kèm thiệp cho ${matchCount} mẫu`;
                            recAdvice = `Đã có ${matchCount} mẫu. Phụ huynh và học sinh chuộng quà tặng trang trọng; bổ sung thiệp tri ân thầy cô trước ngày mở bán (${tracStr}).`;
                        } else {
                            recTitle = `Lên sản phẩm quà tặng tri ân thầy cô đón 20/11`;
                            recAdvice = `Chuẩn bị các mặt hàng trang nhã ngành ${catName} (như sổ bút cao cấp, áo sơ mi, set mỹ phẩm hoặc trà hoa) đóng hộp lịch sự trước (${tracStr}) để đón nhu cầu tri ân.`;
                        }
                    } else {
                        if (matchCount > 0) {
                            recTitle = `Tối ưu hình ảnh & Tạo combo cho ${matchCount} mẫu sẵn có`;
                            recAdvice = `Shop đã có ${matchCount} mẫu ("${firstMatchedTitle}"). Cập nhật lại từ khóa ngách "${kw}" vào tiêu đề và tạo deal mua kèm trước ngày mở bán (${tracStr}).`;
                        } else if (campSavedCount > 0) {
                            recTitle = `Chuẩn bị hàng mẫu thử từ ${campSavedCount} ý tưởng đã lưu`;
                            recAdvice = `Bạn đã lưu ${campSavedCount} ý tưởng đón dịp ${campName} ${evYear}. Chọn 1 mẫu tiềm năng nhất để chuẩn bị số lượng nhỏ trước ngày mở bán (${tracStr}).`;
                        } else {
                            recTitle = `Chuẩn bị mẫu đón đầu từ khóa "${kw}" cho ${campName}`;
                            recAdvice = `Nhu cầu tìm "${kw}" mùa ${evYear} đang bắt đầu tăng. Lên nhanh sản phẩm sẵn có trước ngày mở bán (${tracStr}) để kịp đón sóng.`;
                        }
                    }
                }

                camp.action_recommendation = {
                    title: recTitle,
                    advice: recAdvice,
                    calculation_basis: campaignTimingBasis(camp, actionType as 'close_orders' | 'boost_traffic' | 'prepare_inventory'),
                    cta_label: ctaLabel,
                    target_tab: targetTab,
                    action_type: actionType,
                    badge_text: badgeText,
                    badge_variant: badgeVariant,
                    is_urgent: isUrgent,
                };
            }));
        }

        const [llmTraitActions, aiIdeas] = await Promise.all([traitActionsPromise, aiIdeasPromise]);
        if (llmTraitActions && llmTraitActions.length > 0) {
            data.trait_actions = llmTraitActions;
        }
        data.ai_ideas = aiIdeas;

        return data;
    }
}

