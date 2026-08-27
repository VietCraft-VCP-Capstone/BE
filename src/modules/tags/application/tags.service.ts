import mongoose from 'mongoose';
import { Tag } from '../infrastructure/models/tag.model';
import { Product } from '../../product/infrastructure/models/product.model';
import { generateSlug } from '../../../shared/utils/slug';
import { PageParams, Paginated, clampPage, paginate } from '../../../shared/utils/pagination';
import { ITagsService, TagListOptions, TagStats } from '../types';

/** Thoát ký tự đặc biệt trước khi nhét chuỗi người dùng gõ vào $regex. */
function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Thẻ chưa duyệt lọt vào truy vấn nào thì lộ ra chỗ đó. Dùng một hằng duy nhất
// để không có endpoint nào quên mất điều kiện này.
const APPROVED_ONLY = { status: { $ne: 'pending' } } as const;

class TagsService implements ITagsService {
    /**
     * Bảng thẻ của trang quản trị — CHỈ thẻ đã duyệt.
     *
     * Trước đây hàm này trả về Tag.find() trần, nên thẻ đang chờ duyệt xuất hiện
     * hai lần trên cùng màn hình: một lần ở hàng chờ, một lần trong bảng "thẻ đã
     * duyệt" ngay bên dưới.
     */
    async listTags(opts: TagListOptions, params: PageParams): Promise<Paginated<any>> {
        const query: Record<string, any> = { ...APPROVED_ONLY };
        const search = opts.search?.trim();
        if (search) {
            const rx = new RegExp(escapeRegex(search), 'i');
            const slug = generateSlug(search);
            // Khớp thêm theo slug để gõ không dấu vẫn tìm ra "Sơn mài".
            query.$or = slug
                ? [{ name: rx }, { slug: rx }, { slug: new RegExp(escapeRegex(slug), 'i') }]
                : [{ name: rx }, { slug: rx }];
        }

        // Sắp theo số sản phẩm luôn kèm tên làm khoá phụ: không có khoá phụ thì các
        // thẻ cùng số lượng đảo chỗ ngẫu nhiên giữa hai trang, và một thẻ có thể
        // vừa mất hút ở trang 1 vừa xuất hiện lại ở trang 2.
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
    async listPendingTags(params: PageParams): Promise<Paginated<any>> {
        const query = { status: 'pending' };
        const total = await Tag.countDocuments(query);
        const p = clampPage(params, total);
        // Đề xuất cũ nhất lên trước: hàng chờ duyệt xử lý theo thứ tự đến, người bán
        // gửi từ tuần trước không nên bị đẩy xuống cuối bởi đề xuất gửi sáng nay.
        const items = await Tag.find(query).sort({ created_at: 1 }).skip(p.skip).limit(p.limit).lean();
        return paginate(items, total, p);
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

    // Product có 2 mảng thẻ song song: tag_ids (ObjectId, nguồn sự thật) và tags (tên, legacy/hiển thị).
    // Gắn/bỏ thẻ phải đồng bộ CẢ HAI, nếu không filter marketplace và guard deleteTag sẽ lệch nhau.
    async attachTagToProduct(tagId: string, productId: string): Promise<void> {
        if (!mongoose.Types.ObjectId.isValid(tagId)) throw new Error('Tag not found');
        if (!mongoose.Types.ObjectId.isValid(productId)) throw new Error('Product not found');

        const tag = await Tag.findById(tagId).lean();
        if (!tag) throw new Error('Tag not found');

        // Đếm trước để product_count chỉ tăng đúng 1 lần cho mỗi lần gắn mới.
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
        // Gỡ cả tên thẻ lẫn id: dữ liệu cũ có thể đã lỡ nhét id vào mảng tags.
        const names = tag ? [tagId, tag.name] : [tagId];
        const result = await Product.updateOne(
            { _id: productId },
            { $pull: { tag_ids: new mongoose.Types.ObjectId(tagId), tags: { $in: names } } }
        );
        if (result.matchedCount === 0) throw new Error('Product not found');
        // Chỉ giảm khi thực sự có gỡ, và không cho product_count âm.
        if (result.modifiedCount > 0) {
            await Tag.updateOne({ _id: tagId, product_count: { $gt: 0 } }, { $inc: { product_count: -1 } });
        }
    }

    /** Thẻ cho form seller / marketplace — loại thẻ đang chờ admin duyệt. */
    async listApproved(): Promise<any[]> {
        return Tag.find(APPROVED_ONLY)
            .sort({ name: 1 })
            .select('name slug color _id')
            .lean();
    }
}

export const tagsService: ITagsService = new TagsService();
