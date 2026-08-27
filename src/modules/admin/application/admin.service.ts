import mongoose from 'mongoose';
import { Product } from '../../product/infrastructure/models/product.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { Notification } from '../../notification/infrastructure/models/notification.model';
import { Tag } from '../../tags';
import { ModerationAction } from '../infrastructure/models/moderation-action.model';
import { logger } from '../../../shared/utils/logger';
import { PageParams, Paginated, clampPage, paginate } from '../../../shared/utils/pagination';
import { generateSlug } from '../../../shared/utils/slug';
import { ProductsService } from '../../product/application/product.service';
import { IAdminService } from '../types';
class AdminService implements IAdminService {

    async listProducts(status: string | undefined, params: PageParams): Promise<Paginated<any>> {
        const query = status ? { status } : {};
        // Đếm trước rồi ghim trang: gỡ sản phẩm cuối cùng của trang 3 xong, FE vẫn
        // hỏi trang 3 — trả mảng rỗng thì màn hình báo "chưa có sản phẩm nào" trong
        // khi dữ liệu vẫn nằm ở trang 2.
        const total = await Product.countDocuments(query);
        const p = clampPage(params, total);

        // Sắp theo NHÓM TRẠNG THÁI trước, mới tới thời gian tạo.
        //
        // Chỉ sắp theo created_at thì sản phẩm vừa bị gỡ vẫn nằm nguyên hàng đầu
        // nếu nó là sản phẩm mới nhất — admin xử lý xong rồi mà nó cứ chắn lối.
        // Đưa nhóm đã gỡ xuống cuối: việc đã làm xong thì lùi lại, nhường chỗ cho
        // những sản phẩm đang bán còn phải rà.
        //
        // Lọc theo một trạng thái cụ thể thì cả trang cùng nhóm, thứ hạng thành vô
        // hiệu và thứ tự quay về đúng created_at giảm dần — không cần nhánh riêng.
        const products = await Product.aggregate([
            { $match: query },
            {
                $addFields: {
                    _statusRank: {
                        $switch: {
                            branches: [
                                { case: { $eq: ['$status', 'PUBLISHED'] }, then: 0 },
                                { case: { $eq: ['$status', 'DRAFT'] }, then: 1 },
                                { case: { $eq: ['$status', 'UNPUBLISHED'] }, then: 2 },
                            ],
                            // Bản ghi cũ thiếu hẳn field status: xếp cùng nhóm nháp,
                            // đừng để chúng rơi xuống cuối như thể đã bị gỡ.
                            default: 1,
                        },
                    },
                },
            },
            // _id làm khoá phụ: nhiều sản phẩm seed cùng created_at, không có khoá
            // phụ thì thứ tự giữa hai lần gọi khác nhau và một bản ghi có thể lọt
            // qua khe giữa hai trang.
            { $sort: { _statusRank: 1, created_at: -1, _id: -1 } },
            { $skip: p.skip },
            { $limit: p.limit },
            { $project: { _statusRank: 0 } },
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

        return paginate(enriched, total, p);
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

    /**
     * Khôi phục sản phẩm đã gỡ.
     *
     * `warnings` là những chỗ tin đăng chưa đạt chuẩn. Trước đây chúng là LỖI và
     * chặn hẳn thao tác, khiến admin gỡ xong không khôi phục lại được. Nay chỉ
     * báo lên để admin biết mà nhắc người bán bổ sung.
     */
    async republishProduct(productId: string, reviewerId: string, notes?: string): Promise<{ product: any; warnings: string[] } | null> {
        const { product, warnings } = await ProductsService.republish(productId);

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
        return { product, warnings };
    }

    async getModerationHistory(productId: string): Promise<any[]> {
        return ModerationAction.find({ product_id: productId })
            .sort({ created_at: -1 })
            .lean();
    }

    async getModerationStats(): Promise<{ published: number; unpublished: number; draft: number; total: number }> {
        // total đếm thật, không cộng 3 nhóm: dữ liệu cũ có thể thiếu field status.
        const [published, unpublished, draft, total] = await Promise.all([
            Product.countDocuments({ status: 'PUBLISHED' }),
            Product.countDocuments({ status: 'UNPUBLISHED' }),
            Product.countDocuments({ status: 'DRAFT' }),
            Product.countDocuments({}),
        ]);
        return { published, unpublished, draft, total };
    }
}

export const adminService: IAdminService = new AdminService();
