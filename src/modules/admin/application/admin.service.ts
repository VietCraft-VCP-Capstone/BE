import mongoose from 'mongoose';
import { Product } from '../../product/infrastructure/models/product.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { SellerApplication } from '../../seller/infrastructure/models/seller-application.model';
import { User } from '../../user/infrastructure/models/user.model';
import { notificationService } from '../../notification';
import { Tag } from '../../tags';
import { ModerationAction } from '../infrastructure/models/moderation-action.model';
import { logger } from '../../../shared/utils/logger';
import { PageParams, Paginated, clampPage, paginate } from '../../../shared/utils/pagination';
import { generateSlug } from '../../../shared/utils/slug';
import { ProductsService } from '../../product/application/product.service';
import {
    decryptField,
    maskCardNumber,
    maskBankAccount,
    generatePresignedToken
} from '../../../shared/utils/crypto.service';
import {
    sendSellerApprovalEmail,
    sendSellerRejectionEmail
} from '../../../shared/utils/email.service';
import { resolveUniqueSlug } from '../../seller/application/seller-settings.service';
import { IAdminService } from '../types';

class AdminService implements IAdminService {

    // ==========================================
    // PRODUCT MODERATION
    // ==========================================

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

    // ==========================================
    // SELLER KYC & APPLICATION MANAGEMENT
    // ==========================================

    /**
     * Lấy danh sách hồ sơ đăng ký Seller có bộ lọc và phân trang
     */
    async listSellerApplications(query: {
        status?: string;
        seller_type?: string;
        search?: string;
        page?: number;
        limit?: number;
    }) {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.max(1, Math.min(50, Number(query.limit) || 10));
        const skip = (page - 1) * limit;

        const filter: any = {};
        if (query.status && query.status !== 'ALL') {
            filter.status = query.status;
        }
        if (query.seller_type) {
            filter.seller_type = query.seller_type;
        }
        if (query.search) {
            const regex = new RegExp(String(query.search).trim(), 'i');
            filter.$or = [
                { 'shop_info.shop_name': regex },
                { 'kyc_data.full_name': regex },
                { 'kyc_data.company_name': regex },
                { email: regex },
                { phone: regex },
            ];
        }

        const [items, total] = await Promise.all([
            SellerApplication.find(filter)
                .sort({ updated_at: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            SellerApplication.countDocuments(filter)
        ]);

        const stats = await this.getSellerApplicationStats();

        const formattedItems = items.map((app: any) => ({
            id: app._id,
            user_id: app.user_id,
            seller_type: app.seller_type,
            status: app.status,
            email: app.email,
            phone: app.phone,
            shop_name: app.shop_info?.shop_name,
            full_name: app.kyc_data?.full_name,
            company_name: app.kyc_data?.company_name,
            id_card_masked: maskCardNumber(decryptField(app.kyc_data?.identity_card_number_encrypted)),
            bank_name: app.bank_info?.bank_name,
            account_holder: app.bank_info?.account_holder,
            account_number_masked: maskBankAccount(decryptField(app.bank_info?.account_number_encrypted)),
            is_name_matched: app.bank_info?.is_name_matched,
            created_at: app.created_at,
            updated_at: app.updated_at
        }));

        return {
            items: formattedItems,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            stats
        };
    }

    /**
     * Thống kê số lượng hồ sơ KYC Seller theo trạng thái
     */
    async getSellerApplicationStats() {
        const [total, pending, approved, rejected] = await Promise.all([
            SellerApplication.countDocuments(),
            SellerApplication.countDocuments({ status: 'PENDING_APPROVAL' }),
            SellerApplication.countDocuments({ status: 'APPROVED' }),
            SellerApplication.countDocuments({ status: 'REJECTED' })
        ]);
        return { total, pending, approved, rejected };
    }

    /**
     * Lấy chi tiết hồ sơ KYC (giải mã thông tin và sinh presigned URL xem ảnh bảo mật)
     */
    async getSellerApplicationDetail(id: string) {
        const app = await SellerApplication.findById(id).lean();
        if (!app) throw new Error('Không tìm thấy hồ sơ đăng ký.');

        const rawIdCard = decryptField(app.kyc_data?.identity_card_number_encrypted);
        const rawAccountNumber = decryptField(app.bank_info?.account_number_encrypted);
        const rawBusinessLicense = app.kyc_data?.business_license_number_encrypted
            ? decryptField(app.kyc_data.business_license_number_encrypted)
            : undefined;

        let documentUrls: Record<string, string> = {};
        if (app.kyc_data) {
            const { front_id_image, back_id_image, portrait_image, business_license_image } = app.kyc_data;
            if (front_id_image) {
                documentUrls.front_id_url = `/api/seller/kyc/files/${front_id_image}?token=${generatePresignedToken(front_id_image).token}`;
            }
            if (back_id_image) {
                documentUrls.back_id_url = `/api/seller/kyc/files/${back_id_image}?token=${generatePresignedToken(back_id_image).token}`;
            }
            if (portrait_image) {
                documentUrls.portrait_url = `/api/seller/kyc/files/${portrait_image}?token=${generatePresignedToken(portrait_image).token}`;
            }
            if (business_license_image) {
                documentUrls.business_license_url = `/api/seller/kyc/files/${business_license_image}?token=${generatePresignedToken(business_license_image).token}`;
            }
        }

        return {
            ...app,
            kyc_data: {
                ...app.kyc_data,
                id_card_number: rawIdCard,
                id_card_number_masked: maskCardNumber(rawIdCard),
                business_license_number: rawBusinessLicense,
                business_license_number_masked: rawBusinessLicense ? maskCardNumber(rawBusinessLicense) : undefined,
                ...documentUrls
            },
            bank_info: {
                ...app.bank_info,
                account_number: rawAccountNumber,
                account_number_masked: maskBankAccount(rawAccountNumber)
            }
        };
    }

    /**
     * Phê duyệt hồ sơ Người bán: Cấp role SELLER, Tạo Shop, Gửi email & thông báo
     */
    async approveSellerApplication(id: string, adminId: string) {
        const app = await SellerApplication.findById(id);
        if (!app) throw new Error('Không tìm thấy hồ sơ đăng ký.');

        if (app.status === 'APPROVED') {
            throw new Error('Hồ sơ này đã được phê duyệt trước đó.');
        }

        const user = await User.findById(app.user_id);
        if (!user) throw new Error('Người dùng không tồn tại.');

        user.role = 'SELLER';
        user.seller_status = 'APPROVED';
        await user.save();

        let shop = await Shop.findOne({ owner_id: user._id });
        const decryptedAccountNumber = decryptField(app.bank_info.account_number_encrypted);

        if (!shop) {
            const uniqueSlug = await resolveUniqueSlug(
                app.shop_info.shop_name,
                user._id,
                user._id.toString().substring(18)
            );
            shop = await Shop.create({
                owner_id: user._id,
                shop_name: app.shop_info.shop_name,
                slug: uniqueSlug,
                description: app.shop_info.description || '',
                bank_info: {
                    bank_code: app.bank_info.bank_code,
                    account_number: decryptedAccountNumber,
                    account_holder: app.bank_info.account_holder,
                },
                settings: {
                    shipping: {
                        senderName: app.shop_info.pickup_address.recipient_name,
                        senderPhone: app.shop_info.pickup_address.phone,
                        specificAddress: app.shop_info.pickup_address.address_detail,
                        province: app.shop_info.pickup_address.province_id,
                        district: app.shop_info.pickup_address.district_id,
                        ward: app.shop_info.pickup_address.ward_code,
                        carriers: [
                            { id: 'ghn', name: 'Giao Hàng Nhanh (GHN)', enabled: true, estimatedTime: '1 - 2 ngày' },
                            { id: 'ghtk', name: 'Giao Hàng Tiết Kiệm (GHTK)', enabled: true, estimatedTime: '2 - 3 ngày' }
                        ]
                    },
                    brand: {
                        storeName: app.shop_info.shop_name,
                        mainCategory: app.shop_info.main_category || '',
                        description: app.shop_info.description || ''
                    }
                }
            });
        }

        app.status = 'APPROVED';
        app.review = {
            reviewed_by: new mongoose.Types.ObjectId(adminId),
            reviewed_at: new Date()
        };
        app.audit_trail.push({
            action: 'APPROVED',
            actor_id: new mongoose.Types.ObjectId(adminId),
            timestamp: new Date(),
            note: 'Quản trị viên phê duyệt hồ sơ định danh và kích hoạt gian hàng'
        });
        await app.save();

        try {
            await notificationService.createNotification({
                user_id: user._id,
                type: 'SELLER_APPLICATION_APPROVED',
                title: '🎉 Chúc mừng! Hồ sơ Người bán đã được phê duyệt',
                content: `Gian hàng "${app.shop_info.shop_name}" của bạn đã sẵn sàng hoạt động. Bạn hiện đã có quyền quản lý gian hàng và đăng bán sản phẩm.`,
                link: '/seller/dashboard',
                metadata: { shop_id: shop._id.toString() }
            });
        } catch (e: any) {
            logger.warn(`Lỗi gửi notification duyệt seller: ${e.message}`);
        }

        try {
            await sendSellerApprovalEmail(user.email, app.shop_info.shop_name, user.full_name);
        } catch (e: any) {
            logger.warn(`Lỗi gửi email duyệt seller: ${e.message}`);
        }

        logger.info(`[Admin] Đã duyệt hồ sơ Seller ${app._id} cho user ${user.email}. Tạo shop ${shop._id}.`);

        return {
            success: true,
            message: `Đã phê duyệt thành công gian hàng "${app.shop_info.shop_name}". Quyền Người bán đã được kích hoạt.`,
            shopId: shop._id
        };
    }

    /**
     * Từ chối hồ sơ Người bán
     */
    async rejectSellerApplication(id: string, adminId: string, reason: string) {
        const app = await SellerApplication.findById(id);
        if (!app) throw new Error('Không tìm thấy hồ sơ đăng ký.');

        const rejectionReason = String(reason || '').trim();
        if (!rejectionReason) {
            throw new Error('Vui lòng nhập lý do từ chối để người dùng có thể điều chỉnh hồ sơ.');
        }

        const user = await User.findById(app.user_id);
        if (!user) throw new Error('Người dùng không tồn tại.');

        user.seller_status = 'REJECTED';
        await user.save();

        app.status = 'REJECTED';
        app.review = {
            reviewed_by: new mongoose.Types.ObjectId(adminId),
            reviewed_at: new Date(),
            rejection_reason: rejectionReason
        };
        app.audit_trail.push({
            action: 'REJECTED',
            actor_id: new mongoose.Types.ObjectId(adminId),
            timestamp: new Date(),
            note: `Từ chối hồ sơ. Lý do: ${rejectionReason}`
        });
        await app.save();

        try {
            await notificationService.createNotification({
                user_id: user._id,
                type: 'SELLER_APPLICATION_REJECTED',
                title: 'Hồ sơ Người bán cần cập nhật thông tin',
                content: `Hồ sơ gian hàng "${app.shop_info.shop_name}" chưa được duyệt. Lý do: ${rejectionReason}. Vui lòng kiểm tra và cập nhật lại.`,
                link: '/seller/register',
                metadata: { application_id: app._id.toString(), reason: rejectionReason }
            });
        } catch (e: any) {
            logger.warn(`Lỗi gửi notification từ chối seller: ${e.message}`);
        }

        try {
            await sendSellerRejectionEmail(user.email, app.shop_info.shop_name, user.full_name, rejectionReason);
        } catch (e: any) {
            logger.warn(`Lỗi gửi email từ chối seller: ${e.message}`);
        }

        logger.info(`[Admin] Đã từ chối hồ sơ Seller ${app._id}. Lý do: ${rejectionReason}`);

        return {
            success: true,
            message: 'Đã từ chối hồ sơ đăng ký và gửi thông báo hướng dẫn bổ sung đến người dùng.'
        };
    }
}

export const adminService: IAdminService = new AdminService();
