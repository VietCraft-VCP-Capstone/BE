export type RankMetric = 'units' | 'revenue' | 'views' | 'cart_rate' | 'likes';

export const RANK_METRICS: RankMetric[] = ['units', 'revenue', 'views', 'cart_rate', 'likes'];

export const MIN_RATE_VIEWS = 20;

export interface RankMetrics {
    views: number;
    carts: number;
    orders: number;
    units: number;
    revenue: number;
    likes: number;
    cart_rate: number | null;
    buy_rate: number | null;
    price: number | null;
}

export interface Rank { rank: number; of: number }

export interface CategoryBench {
    median_views: number;
    median_buy_rate: number | null;
    median_checkout: number | null;
    median_price: number | null;
}

export interface RankInsight {
    tone: 'good' | 'warn' | 'bad';
    title: string;
    action: string;
    field: string | null;
    next: 'pricing' | 'tags' | null;
}

type Ctx = { category: string; stock: number | null; score: number | null };

export const rate = (part: number, views: number): number | null =>
    views >= MIN_RATE_VIEWS ? Math.round((part / views) * 1000) / 10 : null;

export function median(xs: number[]): number | null {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function rankOf(mine: number | null, all: (number | null)[]): Rank | null {
    if (mine === null) return null;
    const known = all.filter((v): v is number => v !== null);
    return { rank: 1 + known.filter(v => v > mine).length, of: known.length };
}

const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;

function goodListingSlow(m: RankMetrics, r: Partial<Record<RankMetric, Rank | null>>, b: CategoryBench, ctx: Ctx, low: { reach: boolean; buyer: boolean }): RankInsight | null {
    const slowSales = !!r.units && r.units.of > 1 && r.units.rank > r.units.of / 2;
    if (ctx.score === null || ctx.score < 80 || m.views === 0 || !(low.reach || low.buyer || slowSales)) return null;
    const head = `Đăng chuẩn (${Math.round(ctx.score)} điểm) nhưng bán chậm`;
    if (low.reach && r.views) {
        return { tone: 'warn', title: `${head}: ít người thấy`, field: 'title', next: 'tags',
            action: `Trang sản phẩm đã tốt, chỉ là khách chưa tìm tới (hạng ${r.views.rank}/${r.views.of} về lượt xem trong danh mục ${ctx.category} toàn sàn). Đưa từ khoá khách hay tìm vào tên, gắn tag còn thiếu của danh mục, chia sẻ link lên mạng xã hội hoặc chạy giảm giá ngắn ngày.` };
    }
    if (m.price !== null && b.median_price && m.price > b.median_price * 1.2) {
        const over = Math.round((m.price / b.median_price - 1) * 100);
        return { tone: 'warn', title: `${head}: giá cao hơn mặt bằng`, field: 'variants.retail_price', next: 'pricing',
            action: `Giá ${vnd(m.price)} cao hơn khoảng ${over}% so với mức giữa của danh mục ${ctx.category} toàn sàn (${vnd(b.median_price)}). Thử giảm giá, tặng kèm, hoặc nói rõ điểm khác biệt (chất liệu, làm thủ công) trong mô tả.` };
    }
    if (low.buyer) {
        return { tone: 'warn', title: `${head}: xem nhiều mà ít mua`, field: 'images', next: 'pricing',
            action: `Chỉ ${m.buy_rate}% người xem đặt mua, mức chung của danh mục là ${b.median_buy_rate}%. Thêm ảnh thật khi mặc hoặc dùng, bảng size, xin đánh giá có ảnh, và xem lại giá với phí ship.` };
    }
    return { tone: 'warn', title: `${head} so với cùng danh mục toàn sàn`, field: null, next: 'pricing',
        action: `Đang hạng ${r.units!.rank}/${r.units!.of} về số bán trong danh mục ${ctx.category} toàn sàn. Thử combo, giảm giá ngắn ngày, hoặc so giá với sản phẩm bán chạy cùng loại.` };
}

export function rankingInsights(m: RankMetrics, r: Partial<Record<RankMetric, Rank | null>>, b: CategoryBench, ctx: Ctx): RankInsight[] {
    const out: RankInsight[] = [];
    const low = {
        reach: m.views > 0 && m.views < b.median_views * 0.8 && !!r.views && r.views.rank > r.views.of / 2,
        buyer: m.buy_rate !== null && b.median_buy_rate !== null && m.buy_rate < b.median_buy_rate * 0.7,
    };
    const goodBuyer = m.buy_rate !== null && b.median_buy_rate !== null && m.buy_rate >= b.median_buy_rate;
    const slow = goodListingSlow(m, r, b, ctx, low);

    if (m.views === 0) {
        out.push(ctx.score !== null && ctx.score >= 80
            ? { tone: 'bad', title: `Đăng chuẩn (${Math.round(ctx.score)} điểm) nhưng chưa ai xem trong 30 ngày`, action: 'Trang đã tốt, chỉ là khách chưa tìm tới. Kiểm tra sản phẩm đang hiển thị, đưa từ khoá khách hay tìm vào tên, gắn tag còn thiếu và chia sẻ link lên mạng xã hội để có lượt xem đầu tiên.', field: 'title', next: 'tags' }
            : { tone: 'bad', title: 'Chưa ai xem trong 30 ngày', action: 'Kiểm tra sản phẩm đã được duyệt và đang hiển thị, gắn tag đúng từ khoá khách hay tìm.', field: 'tags', next: 'tags' });
    }
    if (slow) out.push(slow);
    if (r.units?.rank === 1 && r.units.of > 1 && m.units > 0) {
        const days = ctx.stock === null ? null : Math.floor(ctx.stock / (m.units / 30));
        out.push(days !== null && days < 14
            ? { tone: 'warn', title: `Bán chạy nhất danh mục ${ctx.category} toàn sàn nhưng sắp hết hàng`, action: `Còn ${ctx.stock} món, chỉ đủ bán khoảng ${days} ngày. Nhập thêm để không tụt hạng.`, field: 'stock_quantity', next: null }
            : { tone: 'good', title: `Bán chạy nhất danh mục ${ctx.category} toàn sàn`, action: 'Giữ giá và tồn kho ổn định, trả lời đánh giá để giữ hạng.', field: null, next: null });
    }
    if (!slow && low.reach && goodBuyer) {
        out.push({ tone: 'warn', title: 'Ai xem cũng dễ mua, nhưng ít người thấy', action: `Tỉ lệ mua ${m.buy_rate}%, cao hơn mức chung của danh mục là ${b.median_buy_rate}%. Thêm từ khoá vào tên, gắn đủ tag và đổi ảnh bìa nổi bật để có thêm khách.`, field: 'title', next: 'tags' });
    } else if (!slow && low.reach && r.views) {
        out.push({ tone: 'warn', title: `Ít người thấy: hạng ${r.views.rank}/${r.views.of} về lượt xem trong danh mục ${ctx.category} toàn sàn`, action: 'Viết tên rõ loại, chất liệu, kiểu dáng và gắn thêm tag để khớp từ khoá khách gõ.', field: 'tags', next: 'tags' });
    }
    if (!slow && !low.reach && low.buyer) {
        out.push({ tone: 'warn', title: 'Nhiều người xem nhưng ít mua', action: `Chỉ ${m.buy_rate}% người xem đặt mua, mức chung của danh mục là ${b.median_buy_rate}%. So giá với sản phẩm cùng loại, thêm ảnh thật và bảng kích thước.`, field: 'variants.retail_price', next: 'pricing' });
    }
    if (m.carts >= 5 && b.median_checkout !== null && m.orders / m.carts < b.median_checkout * 0.8) {
        out.push({ tone: 'warn', title: 'Khách thêm giỏ rồi bỏ', action: `${m.carts} lượt thêm giỏ nhưng chỉ ${m.orders} đơn. Xem lại phí ship, thời gian giao hoặc tặng mã giảm giá nhỏ.`, field: 'shipping', next: null });
    }
    if (m.likes >= 5 && m.likes > m.orders * 2) {
        out.push({ tone: 'warn', title: 'Được thích nhiều nhưng chưa chốt đơn', action: `${m.likes} người lưu vào yêu thích. Thử giảm giá ngắn ngày hoặc tạo combo để họ quyết định.`, field: 'variants.retail_price', next: 'pricing' });
    }
    if (!out.length && r.views && r.views.rank <= 3 && r.views.of > 1) {
        out.push({ tone: 'good', title: `Top ${r.views.rank} lượt xem danh mục ${ctx.category} toàn sàn`, action: 'Sản phẩm đang được nhiều người thấy, giữ ảnh và giá ổn định.', field: null, next: null });
    }
    if (!out.length) {
        out.push({ tone: 'good', title: 'Đang ổn', action: 'Chưa thấy điểm nghẽn rõ. Thêm ảnh mới hoặc cập nhật mô tả theo mùa để giữ lượt xem.', field: null, next: null });
    }
    return out.slice(0, 2);
}
