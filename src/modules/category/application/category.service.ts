import mongoose from 'mongoose';
import { Category } from '../infrastructure/models/category.model';
import { Product } from '../../product/infrastructure/models/product.model';
import { generateSlug } from '../../../shared/utils/slug';
import { PageParams, Paginated, clampPage, paginate, paginateArray } from '../../../shared/utils/pagination';
import { CategoryNode, buildCategoryTree, countCategoryNodes, filterCategoryTree } from '../utils';
import {
    CategoryListOptions,
    CategoryStats,
    ICategoryService,
    PaginatedCategoryTree,
} from '../types';

/** Thoát ký tự đặc biệt trước khi nhét chuỗi người dùng gõ vào $regex. */
function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class CategoryService implements ICategoryService {
    /**
     * Danh sách phẳng cho trang quản trị: trả CẢ danh mục đang ẩn.
     * Trước đây hàm này hardcode `is_active: true`, nên khi admin bấm "Ẩn danh mục"
     * thì mục đó biến mất khỏi bảng và không còn đường bật lại — dù FE có sẵn nút
     * "Hiển thị danh mục". Lối đọc công khai đã có bộ lọc riêng
     * (ProductsService.listActiveCategories), không phụ thuộc hàm này.
     */
    async listCategories(opts: CategoryListOptions, params: PageParams): Promise<Paginated<any>> {
        const query = this.buildQuery(opts);
        // Đếm trước rồi mới ghim trang: hỏi trang 5 của một tập chỉ còn 3 trang
        // phải nhận về trang 3, không phải mảng rỗng.
        const total = await Category.countDocuments(query);
        const p = clampPage(params, total);
        const items = await Category.find(query)
            .sort({ sort_order: 1, name: 1 })
            .skip(p.skip)
            .limit(p.limit)
            .lean();
        return paginate(items, total, p);
    }

    /**
     * Cây danh mục, cắt trang THEO NÚT GỐC.
     *
     * Không cắt trang trên danh sách phẳng được: nhánh con của một gốc có thể rơi
     * sang trang sau, người dùng sẽ thấy danh mục con mồ côi không rõ thuộc về ai.
     * Mỗi trang vì vậy là một tập cây hoàn chỉnh, `totalNodes` cho biết tổng số
     * mục thật để dòng "N danh mục" không nói dối.
     *
     * Cây phải dựng đủ rồi mới lọc được (bộ lọc còn phải giữ lại tổ tiên của nút
     * khớp), nên phần cắt trang làm trong bộ nhớ. Chấp nhận được: bảng danh mục
     * của một sàn là hàng trăm bản ghi, không phải hàng triệu.
     */
    async listCategoryTree(opts: CategoryListOptions, params: PageParams): Promise<PaginatedCategoryTree> {
        const all = await Category.find().sort({ sort_order: 1, name: 1 }).lean();
        const matches = this.buildMatcher(opts);
        const tree = buildCategoryTree(all);
        const filtered = matches ? filterCategoryTree(tree, matches) : tree;
        return { ...paginateArray(filtered, params), totalNodes: countCategoryNodes(filtered) };
    }

    async getCategoryStats(): Promise<CategoryStats> {
        // parent_id: null bắt cả bản ghi thiếu hẳn field lẫn bản ghi để null.
        const [total, active, roots] = await Promise.all([
            Category.countDocuments({}),
            Category.countDocuments({ is_active: true }),
            Category.countDocuments({ parent_id: null }),
        ]);
        return { total, active, hidden: total - active, roots };
    }

    /** Ô chọn danh mục cha cần thấy MỌI danh mục, kể cả mục nằm ngoài trang đang xem. */
    async listOptions(): Promise<any[]> {
        return Category.find()
            .sort({ sort_order: 1, name: 1 })
            .select('name slug parent_id is_active')
            .lean();
    }

    /* ------------------------------------------------------------ bộ lọc dùng chung */

    private buildQuery(opts: CategoryListOptions): Record<string, any> {
        const query: Record<string, any> = {};
        const search = opts.search?.trim();
        if (search) {
            const rx = new RegExp(escapeRegex(search), 'i');
            const slug = generateSlug(search);
            // Khớp thêm theo slug để gõ không dấu vẫn tìm ra "Gốm sứ".
            query.$or = slug ? [{ name: rx }, { slug: rx }, { slug: new RegExp(escapeRegex(slug), 'i') }] : [{ name: rx }, { slug: rx }];
        }
        if (opts.status === 'active') query.is_active = true;
        if (opts.status === 'hidden') query.is_active = { $ne: true };
        return query;
    }

    /** Cùng luật lọc như buildQuery nhưng chạy trên nút cây đã nằm trong bộ nhớ. */
    private buildMatcher(opts: CategoryListOptions): ((node: CategoryNode) => boolean) | null {
        const search = opts.search?.trim().toLowerCase();
        const status = opts.status && opts.status !== 'all' ? opts.status : null;
        if (!search && !status) return null;

        const slugQuery = search ? generateSlug(search) : '';
        return (node: CategoryNode) => {
            if (status && (status === 'active') !== !!node.is_active) return false;
            if (!search) return true;
            const name = String(node.name || '').toLowerCase();
            const slug = String(node.slug || '').toLowerCase();
            return name.includes(search) || slug.includes(search) || (!!slugQuery && slug.includes(slugQuery));
        };
    }

    async getCategoryById(id: string): Promise<any | null> {
        return Category.findById(id).lean();
    }

    async createCategory(data: any): Promise<any> {
        const doc = new Category({
            name: data.name || '',
            slug: data.slug?.trim() || generateSlug(data.name || ''),
            description: data.description,
            parent_id: data.parent_id,
            icon: data.icon || 'tag',
            sort_order: data.sort_order ?? 0,
            is_active: data.is_active ?? true,
        });
        return doc.save();
    }

    async updateCategory(id: string, data: any): Promise<any | null> {
        // Keep slug in sync when the name changes and no explicit slug was given.
        if (data.name && !data.slug) data.slug = generateSlug(data.name);
        return Category.findByIdAndUpdate(id, data, { new: true }).lean();
    }

    async deleteCategory(id: string): Promise<boolean> {
        // Chặn id rác trước: `new ObjectId('abc')` ném BSONError chứ không phải CastError,
        // nên không được error middleware map về 400 mà rơi thẳng xuống 500.
        if (!mongoose.Types.ObjectId.isValid(id)) return false;

        const children = await Category.find({ parent_id: new mongoose.Types.ObjectId(id) });
        if (children.length > 0) {
            throw new Error('Cannot delete category with subcategories. Detach or reassign them first.');
        }
        // Block delete when products still reference this category (by id or legacy name string).
        const cat = await Category.findById(id).lean();
        if (cat) {
            const inUse = await Product.countDocuments({ $or: [{ category_ids: id }, { categories: cat.name }] });
            if (inUse > 0) {
                throw new Error(`Cannot delete category in use by ${inUse} product(s). Reassign them first.`);
            }
        }
        const result = await Category.findByIdAndDelete(id);
        return !!result;
    }

    /** Danh mục cho marketplace công khai — chỉ mục đang bật, chỉ field cần hiển thị. */
    async listActive(): Promise<any[]> {
        return Category.find({ is_active: true })
            .sort({ sort_order: 1, name: 1 })
            .select('name slug _id')
            .lean();
    }
}
export const categoryService: ICategoryService = new CategoryService();
