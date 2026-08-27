import { PageParams, Paginated } from '../../../shared/utils/pagination';

export type CategoryStatusFilter = 'all' | 'active' | 'hidden';

export interface CategoryListOptions {
    /** Khớp theo tên hoặc slug, không phân biệt hoa thường và không phân biệt dấu. */
    search?: string;
    status?: CategoryStatusFilter;
}

export interface CategoryStats {
    total: number;
    active: number;
    hidden: number;
    roots: number;
}

/** Cây đã cắt trang: `total` đếm nút GỐC (đơn vị của một trang), `totalNodes` đếm mọi cấp. */
export interface PaginatedCategoryTree extends Paginated<any> {
    totalNodes: number;
}

export interface ICategoryService {
    /** Danh sách phẳng đã cắt trang — dùng cho bảng/kết xuất, không dựng cây. */
    listCategories(opts: CategoryListOptions, params: PageParams): Promise<Paginated<any>>;
    /** Cây lồng nhau, cắt trang theo nút gốc; mỗi gốc luôn kèm đủ nhánh con của nó. */
    listCategoryTree(opts: CategoryListOptions, params: PageParams): Promise<PaginatedCategoryTree>;
    /** Số liệu toàn cục — không đổi theo trang đang xem. */
    getCategoryStats(): Promise<CategoryStats>;
    /** Danh sách rút gọn cho ô chọn danh mục cha: cần đủ mọi mục, kể cả ngoài trang hiện tại. */
    listOptions(): Promise<any[]>;
    getCategoryById(id: string): Promise<any | null>;
    createCategory(data: any): Promise<any>;
    updateCategory(id: string, data: any): Promise<any | null>;
    deleteCategory(id: string): Promise<boolean>;
    /** Lối đọc công khai (marketplace): chỉ danh mục đang bật. */
    listActive(): Promise<any[]>;
}
