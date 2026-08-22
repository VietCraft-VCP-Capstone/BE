import mongoose from 'mongoose';
import { Product } from '../../product/infrastructure/models/product.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { User } from '../../user/infrastructure/models/user.model';
import { Notification } from '../../notification/infrastructure/models/notification.model';
import { Category } from '../infrastructure/models/category.model';
import { Tag } from '../infrastructure/models/tag.model';
import { ModerationAction } from '../infrastructure/models/moderation-action.model';
import { logger } from '../../../shared/utils/logger';
import { generateSlug } from '../../../shared/utils/slug';
import { ProductsService } from '../../product/application/product.service';

export interface IAdminService {
    listCategories(filter?: string): Promise<any[]>;
    getCategoryById(id: string): Promise<any | null>;
    createCategory(data: any): Promise<any>;
    updateCategory(id: string, data: any): Promise<any | null>;
    deleteCategory(id: string): Promise<boolean>;
    listTags(): Promise<any[]>;
    getTagById(id: string): Promise<any | null>;
    createTag(data: any): Promise<any>;
    updateTag(id: string, data: any): Promise<any | null>;
    deleteTag(id: string): Promise<boolean>;
    listPendingTags(): Promise<any[]>;
    approveTag(id: string): Promise<any | null>;
    rejectTag(id: string): Promise<boolean>;
    attachTagToProduct(tagId: string, productId: string): Promise<void>;
    detachTagFromProduct(tagId: string, productId: string): Promise<void>;
    listProducts(status: string | undefined, page: number, limit: number): Promise<{
        products: any[];
        total: number;
        page: number;
        limit: number;
    }>;
    unpublishProduct(productId: string, reviewerId: string, reason?: string): Promise<any | null>;
    republishProduct(productId: string, reviewerId: string, notes?: string): Promise<any | null>;
    getModerationHistory(productId: string): Promise<any[]>;
    getModerationStats(): Promise<{ published: number; unpublished: number; draft: number; total: number }>;
}

class AdminService implements IAdminService {

    async listCategories(filter?: string): Promise<any[]> {
        const query = filter
            ? { is_active: true, name: { $regex: filter, $options: 'i' } }
            : { is_active: true };
        return Category.find(query).sort({ sort_order: 1 }).lean();
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

    async listTags(): Promise<any[]> {
        return Tag.find().sort({ name: 1 }).lean();
    }

    async getTagById(id: string): Promise<any | null> {
        return Tag.findById(id).lean();
    }

    async createTag(data: any): Promise<any> {
        const doc = new Tag({
            name: data.name || '',
            slug: data.slug?.trim() || generateSlug(data.name || ''),
            color: data.color || '#007700',
            product_count: 0,
        });
        return doc.save();
    }

    async updateTag(id: string, data: any): Promise<any | null> {
        if (data.name && !data.slug) data.slug = generateSlug(data.name);
        return Tag.findByIdAndUpdate(id, data, { new: true }).lean();
    }

    async deleteTag(id: string): Promise<boolean> {
        // Guard by id AND legacy name string: product.tags stores names, not ids.
        const tag = await Tag.findById(id).lean();
        const inUse = await Product.countDocuments({ $or: [{ tag_ids: id }, ...(tag ? [{ tags: tag.name }] : [])] });
        if (inUse > 0) {
            throw new Error(`Cannot delete tag in use by ${inUse} product(s). Detach it first.`);
        }
        const result = await Tag.findByIdAndDelete(id);
        return !!result;
    }

    // ---- Seller-proposed tag moderation ----
    async listPendingTags(): Promise<any[]> {
        return Tag.find({ status: 'pending' }).sort({ created_at: -1 }).lean();
    }

    // Approve a proposed tag → it becomes a normal active tag.
    async approveTag(id: string): Promise<any | null> {
        return Tag.findByIdAndUpdate(id, { status: 'active' }, { new: true }).lean();
    }

    // Reject a proposed tag → detach from every product (id + legacy name), then delete.
    async rejectTag(id: string): Promise<boolean> {
        const tag = await Tag.findById(id).lean();
        if (!tag) return false;
        await Product.updateMany(
            { $or: [{ tag_ids: id }, { tags: tag.name }] },
            { $pull: { tag_ids: id, tags: tag.name } }
        );
        const result = await Tag.findByIdAndDelete(id);
        return !!result;
    }

    async attachTagToProduct(tagId: string, productId: string): Promise<void> {
        const product = await Product.findById(productId);
        if (!product) throw new Error('Product not found');
        if (!product.tags.includes(tagId)) {
            product.tags.push(tagId);
            await product.save();
            await Tag.findByIdAndUpdate(tagId, { $inc: { product_count: 1 } });
        }
    }

    async detachTagFromProduct(tagId: string, productId: string): Promise<void> {
        const product = await Product.findById(productId);
        if (!product) throw new Error('Product not found');
        product.tags = product.tags.filter((t: string) => t.toString() !== tagId);
        await product.save();
        await Tag.findByIdAndUpdate(tagId, { $inc: { product_count: -1 } });
    }

    async listProducts(status: string | undefined, page: number, limit: number): Promise<{
        products: any[];
        total: number;
        page: number;
        limit: number;
    }> {
        const skip = (page - 1) * limit;
        const query = status ? { status } : {};
        const [products, total] = await Promise.all([
            Product.find(query)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Product.countDocuments(query),
        ]);

        const shopIds = [...new Set(products.map((p: any) => p.shop_id))];
        const shops = await Shop.find({ _id: { $in: shopIds } }).lean();
        const shopMap = new Map(shops.map((s: any) => [s._id.toString(), s]));

        const enriched = products.map((p: any) => ({
            ...p,
            id: p._id.toString(),
            shop_name: shopMap.get(p.shop_id.toString())?.shop_name || 'Unknown Shop',
            seller_id: shopMap.get(p.shop_id.toString())?.owner_id?.toString() || '',
        }));

        return { products: enriched, total, page, limit };
    }

    // Post-moderation: take a live product off the marketplace (violation handling).
    async unpublishProduct(productId: string, reviewerId: string, reason?: string): Promise<any | null> {
        const product = await ProductsService.unpublish(productId, reason);

        await ModerationAction.create({
            product_id: productId,
            reviewer_id: reviewerId,
            action: 'unpublish',
            notes: reason || 'Gỡ bởi quản trị viên',
            rejection_reason: reason,
        });

        const mp = await Product.findById(productId);
        const shop = mp && await Shop.findById(mp.shop_id);
        if (shop) {
            await Notification.create({
                user_id: shop.owner_id,
                type: 'PRODUCT_UNPUBLISHED',
                title: 'Sản phẩm của bạn đã bị gỡ',
                content: `Sản phẩm "${mp!.title}" đã bị gỡ khỏi marketplace${reason ? `: ${reason}` : ''}.`,
            });
        }

        logger.info(`Product ${productId} unpublished by ${reviewerId}${reason ? `: ${reason}` : ''}`);
        return product;
    }

    // Post-moderation: restore a product (re-validates inside ProductsService.republish).
    async republishProduct(productId: string, reviewerId: string, notes?: string): Promise<any | null> {
        const product = await ProductsService.republish(productId);

        await ModerationAction.create({
            product_id: productId,
            reviewer_id: reviewerId,
            action: 'republish',
            notes: notes || 'Khôi phục bởi quản trị viên',
        });

        const mp = await Product.findById(productId);
        const shop = mp && await Shop.findById(mp.shop_id);
        if (shop) {
            await Notification.create({
                user_id: shop.owner_id,
                type: 'PRODUCT_REPUBLISHED',
                title: 'Sản phẩm của bạn đã được khôi phục',
                content: `Sản phẩm "${mp!.title}" đã được khôi phục và hiển thị lại trên marketplace.`,
            });
        }

        logger.info(`Product ${productId} republished by ${reviewerId}`);
        return product;
    }

    async getModerationHistory(productId: string): Promise<any[]> {
        return ModerationAction.find({ product_id: productId })
            .sort({ created_at: -1 })
            .lean();
    }

    async getModerationStats(): Promise<{ published: number; unpublished: number; draft: number; total: number }> {
        const [published, unpublished, draft] = await Promise.all([
            Product.countDocuments({ status: 'PUBLISHED' }),
            Product.countDocuments({ status: 'UNPUBLISHED' }),
            Product.countDocuments({ status: 'DRAFT' }),
        ]);
        return { published, unpublished, draft, total: published + unpublished + draft };
    }
}

export const adminService: IAdminService = new AdminService();
