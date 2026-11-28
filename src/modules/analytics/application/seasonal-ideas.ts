// Ý tưởng AI cho dịp mùa vụ: kho tín hiệu, chọn tín hiệu cho từng đợt, dựng prompt và đọc kết quả LLM.
// Mỗi ý tưởng neo vào một tín hiệu dữ liệu riêng (nhóm bán chạy / từ khóa cơ hội) để các ý tưởng không cùng một khuôn
// và "Gợi ý thêm" luôn dựa vào tín hiệu chưa dùng.
import { isGrounded } from './llm-grounding';
import { lessonPromptBlock, type PreviousSeasonLesson } from './seasonal-lesson';
import { stableIdeaId } from './seasonal-plan';

export const IDEAS_PER_BATCH = 3;
export const MAX_IDEAS_PER_CAMPAIGN = 30;

export interface ShopSeasonalIdea {
    id: string;
    title: string;
    concept: string;
    target_price_vnd: number;
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

/** Dữ liệu dựng prompt ý tưởng (lưu kèm ý tưởng để "Gợi ý thêm" dùng lại). */
export interface IdeaInputs {
    shopName: string;
    catName: string;
    campId: string;
    campName: string;
    eventYear: number;
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
    /** Bài học mùa trước của shop cho dịp này (đánh giá + ghi chú + kết quả ý tưởng) */
    previousSeason?: PreviousSeasonLesson | null;
}

export interface IdeaAnchor { key: string; text: string }

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Mọi nhóm bán chạy có tên, rồi mọi từ khóa cơ hội; key ổn định theo tên (số liệu đổi hằng ngày). */
export function anchorPool(inputs: IdeaInputs): IdeaAnchor[] {
    const out: IdeaAnchor[] = [];
    const seen = new Set<string>();
    const add = (key: string, text: string) => {
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ key, text });
    };
    for (const c of inputs.occasionIndustryClusters || []) {
        if (!norm(c?.title)) continue;
        add(`cluster:${norm(c.title)}`, `nhóm bán chạy "${c.title}" (${c.sold_count ?? 0} bán, ${c.price_vnd?.toLocaleString('vi-VN') ?? ''}đ, ${c.platform})`);
    }
    for (const k of inputs.topOppKeywords || []) {
        if (!norm(k?.tag)) continue;
        add(`kw:${norm(k.tag)}`, `từ khóa "${k.tag}" (nhu cầu: ${k.volume}, đối thủ: ${k.competition})`);
    }
    return out;
}

/** Tín hiệu đã dùng của mục ý tưởng đã lưu; mục kiểu cũ (chưa lưu) coi đợt đầu đã dùng 3 tín hiệu đầu. */
export function usedAnchorsOf(entry: { used_anchors?: unknown } | null | undefined, pool: IdeaAnchor[]): string[] {
    if (Array.isArray(entry?.used_anchors)) return entry!.used_anchors.map(String);
    return pool.slice(0, IDEAS_PER_BATCH).map(a => a.key);
}

export function nextAnchors(pool: IdeaAnchor[], used: string[], n = IDEAS_PER_BATCH): IdeaAnchor[] {
    const usedSet = new Set(used);
    return pool.filter(a => !usedSet.has(a.key)).slice(0, n);
}

const priceBandText = (inputs: IdeaInputs) =>
    `${Math.round(inputs.priceBand.min / 1000)}k – ${Math.round(inputs.priceBand.max / 1000)}k`;

export function draftBasisOf(inputs: IdeaInputs): ShopSeasonalIdea['draft_basis'] {
    return {
        shop_style: inputs.shopStyleKeywords.slice(0, 5).join(', ') || inputs.catName,
        price_band: priceBandText(inputs),
        trend_signal: inputs.ordersGrowth != null
            ? `Cầu dịp +${inputs.ordersGrowth}%, AOV ngành +${inputs.spendingGrowth ?? 0}%`
            : 'Dữ liệu đa sàn',
        top_keywords: inputs.topOppKeywords.slice(0, 4).map(k => k.tag),
    };
}

const ROLES = ['sản phẩm chủ lực đúng phong cách shop', 'set/combo quà tăng giá trị đơn', 'món dễ chốt ở đáy khung giá'];

/** Prompt soạn ý tưởng: số ý tưởng = số tín hiệu (đợt đầu không có tín hiệu thì 3); `existingTitles` để tránh trùng. */
export function ideasPrompt(inputs: IdeaInputs, anchors: IdeaAnchor[], existingTitles: string[]): string {
    const n = anchors.length || IDEAS_PER_BATCH;
    const p = inputs;
    const priceBandStr = priceBandText(p);
    const shopStyleStr = draftBasisOf(p).shop_style;
    const anchorLines = Array.from({ length: n }, (_, i) =>
        `  Ý tưởng ${i + 1}: ${anchors[i] ? `dựa vào ${anchors[i].text}` : 'không có tín hiệu riêng'} · vai trò: ${ROLES[i % ROLES.length]}`,
    ).join('\n');
    const existingBlock = existingTitles.length
        ? `\nĐÃ CÓ (không được trùng hay na ná, kể cả đổi vài chữ):\n${existingTitles.map(t => `  - ${t}`).join('\n')}\n`
        : '';
    return `Bạn là chuyên gia phát triển sản phẩm TMĐT. Hãy đọc BẢN PHÁC THẢO DỮ LIỆU THẬT dưới đây và tổng hợp đúng ${n} ý tưởng sản phẩm MỚI cho shop (phải bám sát SỐ LIỆU TOÀN NGÀNH CỦA DỊP ${p.campName} ${p.eventYear} đồng thời mang PHONG CÁCH RIÊNG của shop; KHÔNG tự bịa thêm số liệu ngoài bản phác thảo; TUYỆT ĐỐI KHÔNG nhắc tới các năm cũ như 2023, 2024, 2025 — nếu cần ghi năm chỉ được dùng năm ${p.eventYear}):

BẢN PHÁC THẢO (STRICT SCOPE):
- Shop: "${p.shopName}" · Ngành: "${p.catName}" · Năm sự kiện: ${p.eventYear}
- Sản phẩm mẫu & phong cách shop: ${p.shopSampleTitles.slice(0, 4).join(' | ') || 'Chưa có'} (từ khóa phong cách: ${shopStyleStr})
- Khung giá shop: ${priceBandStr} (trung bình ${p.priceBand.avg.toLocaleString('vi-VN')}đ)
- Dịp mua sắm: ${p.campName} ${p.eventYear}
- Số liệu TOÀN NGÀNH trong dịp ${p.campName}:
  + Quy mô ngành: ${p.industryScale?.productsCount ?? 'N/A'} sản phẩm từ ${p.industryScale?.sellersCount ?? 'N/A'} gian hàng (${p.industryScale?.totalSold ?? 'N/A'} lượt bán đa sàn)
  + Dải giá ngành dịp này: ${p.occasionIndustryPriceBand?.min ? `${Math.round(p.occasionIndustryPriceBand.min / 1000)}k–${Math.round((p.occasionIndustryPriceBand.max || 0) / 1000)}k` : priceBandStr}
  + Nhóm sản phẩm đang bán chạy toàn ngành dịp ${p.campName}: ${(p.occasionIndustryClusters || []).slice(0, 3).map(c => `"${c.title}" (${c.sold_count ?? 0} bán, ${c.price_vnd?.toLocaleString('vi-VN') ?? ''}đ, ${c.platform})`).join('; ') || 'Đang tổng hợp'}
- Tín hiệu thuật toán (QuantileForecaster + STL 5 năm): Cầu cao điểm +${p.ordersGrowth ?? 'N/A'}%, Giá trị đơn ngành +${p.spendingGrowth ?? 'N/A'}%, Tỷ lệ combo ngành ${p.comboInd ?? 'N/A'}%
- Từ khóa cơ hội toàn ngành: ${p.topOppKeywords.slice(0, 5).map(k => `"${k.tag}" (nhu cầu: ${k.volume}, đối thủ: ${k.competition})`).join('; ')}
${lessonPromptBlock(p.previousSeason)}
${existingBlock}
PHÂN VAI (bắt buộc, theo đúng thứ tự):
${anchorLines}

QUY TẮC ĐỂ CÁC Ý TƯỞNG KHÁC NHAU THẬT SỰ:
- Mỗi ý tưởng là một LOẠI SẢN PHẨM khác nhau (vd không được tất cả đều là "set áo + váy/quần") và khác cách bán (đơn lẻ / combo / món nhỏ).
- Tên và mô tả không dùng chung khuôn câu, chung cụm mở đầu hay chung chi tiết trang trí (ren, hoa, bèo... chỉ xuất hiện ở tối đa 1 ý tưởng).
- "concept" nói điểm khác biệt cụ thể (chất liệu, chi tiết thiết kế, cách đóng gói, ai mua tặng ai); KHÔNG kết câu bằng "trong dịp ${p.campName} ${p.eventYear}" hay lặp lại tên dịp.
- "why_it_fits_shop" trích đúng tín hiệu đã phân cho ý tưởng đó (tên nhóm/từ khóa và số của nó), không dùng chung một câu cho các ý tưởng.

Yêu cầu trả về JSON array đúng ${n} phần tử:
[
  {
    "title": "Tên ý tưởng sản phẩm mới hấp dẫn, kết hợp nhu cầu dịp ${p.campName} và phong cách shop (8-14 từ, không ghi năm cũ)",
    "concept": "Điểm khác biệt cụ thể về thiết kế / chất liệu / đóng gói / người mua (1-2 câu, không nhắc lại tên dịp)",
    "target_price_vnd": số nguyên VND phù hợp khung giá shop & ngành (${Math.min(p.priceBand.min, p.occasionIndustryPriceBand?.min || p.priceBand.min)}-${Math.max(Math.round(p.priceBand.max * 1.25), p.occasionIndustryPriceBand?.max || p.priceBand.max)}),
    "tags": ["tag 1", "tag 2", "tag 3"],
    "why_it_fits_shop": "Trích tín hiệu đã phân cho ý tưởng này (tên + số) và vì sao hợp phong cách shop (1 câu)"
  }
]`;
}

const clean = (v: unknown) => String(v ?? '').replace(/[*_#]/g, '').trim();

/** Ý tưởng hợp lệ từ JSON của LLM: đủ tên + mô tả, số trong câu chữ có trong dữ liệu, không trùng tên đã có. */
export function parseLlmIdeas(parsed: unknown, inputs: IdeaInputs, existingTitles: string[]): ShopSeasonalIdea[] {
    if (!Array.isArray(parsed)) return [];
    const draftBasis = draftBasisOf(inputs);
    const seen = new Set(existingTitles.map(norm));
    const out: ShopSeasonalIdea[] = [];
    for (const item of parsed.slice(0, IDEAS_PER_BATCH) as any[]) {
        const title = clean(item?.title).replace(/\s+/g, ' ');
        const concept = clean(item?.concept);
        if (!title || !concept || seen.has(norm(title))) continue;
        const price = Math.max(50000, Math.round((Number(item.target_price_vnd) || inputs.priceBand.avg) / 1000) * 1000);
        const why = clean(item.why_it_fits_shop);
        // LLM chỉ diễn giải: số trong câu chữ phải có trong dữ liệu đầu vào (hoặc là giá chính nó đề xuất)
        if (!isGrounded([title, concept, why], { inputs, draftBasis, price, raw: item.target_price_vnd })) continue;
        seen.add(norm(title));
        out.push({
            id: stableIdeaId('ai', inputs.campId, title),
            title,
            concept,
            target_price_vnd: price,
            tags: Array.isArray(item.tags) ? item.tags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 5) : draftBasis.top_keywords.slice(0, 3),
            why_it_fits_shop: why,
            source_type: 'llm_scoped',
            draft_basis: draftBasis,
        });
    }
    return out;
}

/** Chỉ giữ các trường dựng prompt (bỏ ID shop, ý tưởng đã lưu…) để lưu kèm ý tưởng. */
export function pickIdeaInputs(src: IdeaInputs): IdeaInputs {
    return {
        shopName: src.shopName,
        catName: src.catName,
        campId: src.campId,
        campName: src.campName,
        eventYear: src.eventYear,
        shopStyleKeywords: src.shopStyleKeywords || [],
        shopSampleTitles: src.shopSampleTitles || [],
        priceBand: src.priceBand,
        topOppKeywords: src.topOppKeywords || [],
        ordersGrowth: src.ordersGrowth ?? null,
        spendingGrowth: src.spendingGrowth ?? null,
        comboInd: src.comboInd ?? null,
        occasionIndustryClusters: src.occasionIndustryClusters || [],
        occasionIndustryPriceBand: src.occasionIndustryPriceBand,
        industryScale: src.industryScale,
        previousSeason: src.previousSeason ?? null,
    };
}
