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
import { cacheService } from '../../../shared/services/cache.service';

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class CategoryService implements ICategoryService {

    private async invalidateCache() {
        await Promise.all([
            cacheService.delByPattern('vietcraft:categories:*'),
            cacheService.delByPattern('vietcraft:products:*'),
        ]);
    }

    async listCategories(opts: CategoryListOptions, params: PageParams): Promise<Paginated<any>> {
        const query = this.buildQuery(opts);

        const total = await Category.countDocuments(query);
        const p = clampPage(params, total);
        const items = await Category.find(query)
            .sort({ sort_order: 1, name: 1 })
            .skip(p.skip)
            .limit(p.limit)
            .lean();
        return paginate(items, total, p);
    }

    async listCategoryTree(opts: CategoryListOptions, params: PageParams): Promise<PaginatedCategoryTree> {
        const cacheKey = `vietcraft:categories:tree:${cacheService.hashKey({ opts, params })}`;
        return cacheService.getOrSet(cacheKey, async () => {
            const all = await Category.find().sort({ sort_order: 1, name: 1 }).lean();
            const matches = this.buildMatcher(opts);
            const tree = buildCategoryTree(all);
            const filtered = matches ? filterCategoryTree(tree, matches) : tree;
            return { ...paginateArray(filtered, params), totalNodes: countCategoryNodes(filtered) };
        }, 600);
    }

    async getCategoryStats(): Promise<CategoryStats> {
        return cacheService.getOrSet('vietcraft:categories:stats', async () => {
            const [total, active, roots] = await Promise.all([
                Category.countDocuments({}),
                Category.countDocuments({ is_active: true }),
                Category.countDocuments({ parent_id: null }),
            ]);
            return { total, active, hidden: total - active, roots };
        }, 300);
    }

    async listOptions(): Promise<any[]> {
        return Category.find()
            .sort({ sort_order: 1, name: 1 })
            .select('name slug parent_id is_active')
            .lean();
    }

    private buildQuery(opts: CategoryListOptions): Record<string, any> {
        const query: Record<string, any> = {};
        const search = opts.search?.trim();
        if (search) {
            const rx = new RegExp(escapeRegex(search), 'i');
            const slug = generateSlug(search);
            query.$or = slug ? [{ name: rx }, { slug: rx }, { slug: new RegExp(escapeRegex(slug), 'i') }] : [{ name: rx }, { slug: rx }];
        }
        if (opts.status === 'active') query.is_active = true;
        if (opts.status === 'hidden') query.is_active = { $ne: true };
        return query;
    }

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
        const saved = await doc.save();
        await this.invalidateCache();
        return saved;
    }

    async updateCategory(id: string, data: any): Promise<any | null> {
        if (data.name && !data.slug) data.slug = generateSlug(data.name);
        const updated = await Category.findByIdAndUpdate(id, data, { new: true }).lean();
        await this.invalidateCache();
        return updated;
    }

    async deleteCategory(id: string): Promise<boolean> {
        if (!mongoose.Types.ObjectId.isValid(id)) return false;

        const children = await Category.find({ parent_id: new mongoose.Types.ObjectId(id) });
        if (children.length > 0) {
            throw new Error('Cannot delete category with subcategories. Detach or reassign them first.');
        }
        const cat = await Category.findById(id).lean();
        if (cat) {
            const inUse = await Product.countDocuments({ $or: [{ category_ids: id }, { categories: cat.name }] });
            if (inUse > 0) {
                throw new Error(`Cannot delete category in use by ${inUse} product(s). Reassign them first.`);
            }
        }
        const result = await Category.findByIdAndDelete(id);
        if (result) {
            await this.invalidateCache();
        }
        return !!result;
    }

    async listActive(): Promise<any[]> {
        return cacheService.getOrSet('vietcraft:categories:active', async () => {
            return Category.find({ is_active: true })
                .sort({ sort_order: 1, name: 1 })
                .select('name slug _id')
                .lean();
        }, 300);
    }
}
export const categoryService: ICategoryService = new CategoryService();
