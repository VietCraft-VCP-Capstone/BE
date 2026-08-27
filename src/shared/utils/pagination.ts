/**
 * Phân trang dùng chung cho mọi endpoint danh sách.
 *
 * Mọi endpoint có phân trang trả về CÙNG một phong bì:
 *   { items, total, page, limit, totalPages }
 * FE nhờ vậy chỉ cần một component phân trang duy nhất, không phải nhớ endpoint
 * nào gọi mảng là `products`, endpoint nào gọi là `data`.
 */

export interface PageParams {
    page: number;
    limit: number;
    skip: number;
}

export interface Paginated<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** `?page=1&page=2` cho ra mảng chứ không phải chuỗi — lấy phần tử cuối rồi mới parse. */
function toInt(raw: unknown, fallback: number): number {
    const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    const parsed = parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Làm sạch page/limit từ query string.
 *
 * limit bị chặn trần: không có trần thì `?limit=999999` biến một endpoint danh
 * sách thành đòn kéo sập bộ nhớ chỉ bằng thanh địa chỉ.
 */
export function parsePageParams(
    query: Record<string, unknown>,
    opts: { defaultLimit?: number; maxLimit?: number } = {}
): PageParams {
    const maxLimit = opts.maxLimit ?? MAX_LIMIT;
    const page = Math.max(1, toInt(query.page, 1));
    const limit = Math.min(maxLimit, Math.max(1, toInt(query.limit, opts.defaultLimit ?? DEFAULT_LIMIT)));
    return { page, limit, skip: (page - 1) * limit };
}

export function totalPagesOf(total: number, limit: number): number {
    return Math.max(1, Math.ceil(total / limit));
}

/**
 * Ghim trang vào khoảng hợp lệ rồi tính lại skip.
 *
 * Xoá phần tử cuối cùng của trang 5 xong, FE vẫn hỏi trang 5. Nếu cứ thế truy vấn
 * thì trả về mảng rỗng và người dùng nhìn thấy "không có dữ liệu" dù dữ liệu vẫn
 * còn ở trang 4. Ghim lại rồi báo `page` thật trong phản hồi để FE tự đồng bộ.
 */
export function clampPage(params: PageParams, total: number): PageParams {
    const page = Math.min(params.page, totalPagesOf(total, params.limit));
    return { page, limit: params.limit, skip: (page - 1) * params.limit };
}

export function paginate<T>(items: T[], total: number, params: PageParams): Paginated<T> {
    return {
        items,
        total,
        page: params.page,
        limit: params.limit,
        totalPages: totalPagesOf(total, params.limit),
    };
}

/**
 * Cắt trang cho mảng đã nằm sẵn trong bộ nhớ.
 *
 * Dùng cho cây danh mục: muốn lọc mà vẫn giữ được tổ tiên của nút khớp thì phải
 * dựng đủ cây trước, không thể đẩy phần cắt trang xuống cho MongoDB.
 */
export function paginateArray<T>(all: T[], params: PageParams): Paginated<T> {
    const p = clampPage(params, all.length);
    return paginate(all.slice(p.skip, p.skip + p.limit), all.length, p);
}
