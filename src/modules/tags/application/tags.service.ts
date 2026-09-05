import mongoose from 'mongoose';
import { Tag } from '../infrastructure/models/tag.model';
import { Product } from '../../product/infrastructure/models/product.model';
import { generateSlug } from '../../../shared/utils/slug';
import { PageParams, Paginated, clampPage, paginate } from '../../../shared/utils/pagination';
import { ITagsService, TagListOptions, TagStats } from '../types';

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const APPROVED_ONLY = { status: { $ne: 'pending' } } as const;

class TagsService implements ITagsService {
    async listTags(opts: TagListOptions, params: PageParams): Promise<Paginated<any>> {
        const query: Record<string, any> = { ...APPROVED_ONLY };
        const search = opts.search?.trim();
        if (search) {
            const rx = new RegExp(escapeRegex(search), 'i');
            const slug = generateSlug(search);
            query.$or = slug
                ? [{ name: rx }, { slug: rx }, { slug: new RegExp(escapeRegex(slug), 'i') }]
                : [{ name: rx }, { slug: rx }];
        }

        const sort: Record<string, 1 | -1> =
            opts.sort === 'name' ? { name: 1 } : { product_count: -1, name: 1 };

        const total = await Tag.countDocuments(query);
        const p = clampPage(params, total);
        const items = await Tag.find(query).sort(sort).skip(p.skip).limit(p.limit).lean();
        return paginate(items, total, p);
    }

    async getTagStats(): Promise<TagStats> {
        const [agg, pending] = await Promise.all([
            Tag.aggregate([
                { $match: APPROVED_ONLY },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        tagged: { $sum: { $ifNull: ['$product_count', 0] } },
                        unused: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$product_count', 0] }, 0] }, 0, 1] } },
                    },
                },
            ]),
            Tag.countDocuments({ status: 'pending' }),
        ]);
        const row = agg[0] || { total: 0, tagged: 0, unused: 0 };
        return { total: row.total, pending, tagged: row.tagged, unused: row.unused };
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
        const tag = await Tag.findById(id).lean();
        const inUse = await Product.countDocuments({ $or: [{ tag_ids: id }, ...(tag ? [{ tags: tag.name }] : [])] });
        if (inUse > 0) {
            throw new Error(`Cannot delete tag in use by ${inUse} product(s). Detach it first.`);
        }
        const result = await Tag.findByIdAndDelete(id);
        return !!result;
    }

    async listPendingTags(params: PageParams): Promise<Paginated<any>> {
        const query = { status: 'pending' };
        const total = await Tag.countDocuments(query);
        const p = clampPage(params, total);
        const items = await Tag.find(query).sort({ created_at: 1 }).skip(p.skip).limit(p.limit).lean();
        return paginate(items, total, p);
    }

    async approveTag(id: string): Promise<any | null> {
        return Tag.findByIdAndUpdate(id, { status: 'active' }, { new: true }).lean();
    }

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
        if (!mongoose.Types.ObjectId.isValid(tagId)) throw new Error('Tag not found');
        if (!mongoose.Types.ObjectId.isValid(productId)) throw new Error('Product not found');

        const tag = await Tag.findById(tagId).lean();
        if (!tag) throw new Error('Tag not found');

        const alreadyLinked = await Product.countDocuments({ _id: productId, tag_ids: tagId });
        const result = await Product.updateOne(
            { _id: productId },
            { $addToSet: { tag_ids: new mongoose.Types.ObjectId(tagId), tags: tag.name } }
        );
        if (result.matchedCount === 0) throw new Error('Product not found');
        if (!alreadyLinked) {
            await Tag.findByIdAndUpdate(tagId, { $inc: { product_count: 1 } });
        }
    }

    async detachTagFromProduct(tagId: string, productId: string): Promise<void> {
        if (!mongoose.Types.ObjectId.isValid(tagId)) throw new Error('Tag not found');
        if (!mongoose.Types.ObjectId.isValid(productId)) throw new Error('Product not found');

        const tag = await Tag.findById(tagId).lean();
        const names = tag ? [tagId, tag.name] : [tagId];
        const result = await Product.updateOne(
            { _id: productId },
            { $pull: { tag_ids: new mongoose.Types.ObjectId(tagId), tags: { $in: names } } }
        );
        if (result.matchedCount === 0) throw new Error('Product not found');
        if (result.modifiedCount > 0) {
            await Tag.updateOne({ _id: tagId, product_count: { $gt: 0 } }, { $inc: { product_count: -1 } });
        }
    }

    async listApproved(): Promise<any[]> {
        return Tag.find(APPROVED_ONLY)
            .sort({ name: 1 })
            .select('name slug color _id')
            .lean();
    }
}

export const tagsService: ITagsService = new TagsService();

