import mongoose from 'mongoose';
import { Product } from '../../product/infrastructure/models/product.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { notificationService } from '../../notification';
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
        const total = await Product.countDocuments(query);
        const p = clampPage(params, total);
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
                            default: 1,
                        },
                    },
                },
            },
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
            await notificationService.createNotification({
                user_id: shop.owner_id.toString(),
                type: 'PRODUCT_UNPUBLISHED',
                title: 'Sản phẩm của bạn đã bị gỡ',
                content: `Sản phẩm "${mp!.title}" đã bị gỡ khỏi marketplace${reason ? `: ${reason}` : ''}.`,
                link: `/seller/products`,
                metadata: { productId }
            });
        }

        logger.info(`Product ${productId} unpublished by ${reviewerId}${reason ? `: ${reason}` : ''}`);
        return product;
    }

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
            await notificationService.createNotification({
                user_id: shop.owner_id.toString(),
                type: 'PRODUCT_REPUBLISHED',
                title: 'Sản phẩm của bạn đã được khôi phục',
                content: `Sản phẩm "${mp!.title}" đã được khôi phục và hiển thị lại trên marketplace.`,
                link: `/seller/products`,
                metadata: { productId }
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
