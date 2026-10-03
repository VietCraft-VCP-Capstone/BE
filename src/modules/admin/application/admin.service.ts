import mongoose from 'mongoose';
import { Product } from '../../product/infrastructure/models/product.model';
import { Order } from '../../order/infrastructure/models/order.model';
import { Category } from '../../category';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { SellerApplication } from '../../seller/infrastructure/models/seller-application.model';
import { User } from '../../user/infrastructure/models/user.model';
import { notificationService } from '../../notification';
import { Tag } from '../../tags';
import { ModerationAction } from '../infrastructure/models/moderation-action.model';
import { logger } from '../../../shared/utils/logger';
import { CommissionSetting } from '../../../shared/services/commission-setting.service';
import { pickCommissionRule } from '../../../shared/utils/commission';
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
import { CommissionOverview, FinanceOverview, FinanceTotals, IAdminService } from '../types';

/**
 * Cửa sổ thời gian để ước lượng tác động khi đổi % hoa hồng. 30 ngày đủ dài để làm phẳng
 * biến động theo ngày, đủ ngắn để phản ánh tình hình hiện tại chứ không phải năm ngoái.
 */
const COMMISSION_IMPACT_PERIOD_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
/** BR-118: chặn truy vấn quá 365 ngày để không kéo sập DB. */
const MAX_FINANCE_RANGE_DAYS = 365;
/** Sàn bán ở Việt Nam: ngày doanh thu phải cắt theo giờ VN, không phải UTC. */
const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';
/** Điều kiện "đơn đã thanh toán" dùng chung cho mọi phép cộng tiền (BR-141). */
const PAID_COND = { $eq: ['$payment_status', 'PAID'] };

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
            const { front_id_image, back_id_image, business_license_image } = app.kyc_data;
            // `portrait_image` đã bị gỡ khỏi schema KYC ở nhánh dev (luồng đăng ký không còn
            // thu ảnh chân dung), nhưng hồ sơ nộp trước đó vẫn còn trường này trong DB và
            // findById().lean() vẫn trả về. Đọc rời ra để admin xem được hồ sơ cũ mà không
            // phụ thuộc vào kiểu đã xoá. Khi dữ liệu cũ hết giá trị sử dụng thì xoá cả khối
            // này lẫn phần hiển thị portrait_url bên AdminSellers.tsx.
            const portrait_image = (app.kyc_data as { portrait_image?: string }).portrait_image;
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

    /**
     * Số liệu thu nhập của sàn — SRS 3.11.4 / màn "Financial Commission Overview".
     *
     * BR-141: chỉ tính trên đơn ĐÃ THANH TOÁN. Đơn PENDING chưa phải tiền thật, gộp vào là
     * thổi doanh thu. BR-118: tối đa 365 ngày một lượt truy vấn.
     */
    async getFinanceOverview(days: number): Promise<FinanceOverview> {
        const period = Math.min(MAX_FINANCE_RANGE_DAYS, Math.max(1, Math.floor(days) || 30));
        const to = new Date();
        const from = new Date(to.getTime() - period * DAY_MS);
        // BR-142: kỳ liền trước có cùng độ dài, để so sánh trên cùng một thước đo.
        const prevFrom = new Date(from.getTime() - period * DAY_MS);

        const money = (field: string) => ({ $sum: { $toDouble: `$financial_breakdown.${field}` } });
        const totalsGroup = {
            _id: null,
            orders: { $sum: 1 },
            gmv: money('subtotal'),
            commission: money('platform_fee'),
            payout: money('seller_payout_amount'),
            shipping: money('shipping_fee'),
            discount: money('coupon_discount'),
        };
        const round = (t: any): FinanceTotals => ({
            orders: t?.orders || 0,
            gmv: Math.round(t?.gmv || 0),
            commission: Math.round(t?.commission || 0),
            payout: Math.round(t?.payout || 0),
            shipping: Math.round(t?.shipping || 0),
            discount: Math.round(t?.discount || 0),
        });

        const paidIn = (start: Date, end: Date) => ({
            payment_status: 'PAID',
            created_at: { $gte: start, $lt: end },
        });

        const [currentAgg, previousAgg, dailyAgg, shopAgg, recentDocs, refundedAgg, commissionPercent] =
            await Promise.all([
                Order.aggregate([{ $match: paidIn(from, to) }, { $group: totalsGroup }]),
                Order.aggregate([{ $match: paidIn(prevFrom, from) }, { $group: totalsGroup }]),
                Order.aggregate([
                    { $match: paidIn(from, to) },
                    {
                        $group: {
                            // Gom theo ngày GIỜ VIỆT NAM; để UTC thì đơn đặt buổi tối bị đẩy sang hôm sau.
                            _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: VN_TIMEZONE } },
                            gmv: money('subtotal'),
                            commission: money('platform_fee'),
                            orders: { $sum: 1 },
                        },
                    },
                    { $sort: { _id: 1 } },
                ]),
                Order.aggregate([
                    { $match: paidIn(from, to) },
                    {
                        $group: {
                            _id: '$shop_id',
                            orders: { $sum: 1 },
                            gmv: money('subtotal'),
                            commission: money('platform_fee'),
                        },
                    },
                    { $sort: { commission: -1 } },
                    { $limit: 8 },
                ]),
                Order.find({ payment_status: 'PAID', created_at: { $gte: from, $lt: to } })
                    .sort({ created_at: -1 })
                    .limit(12)
                    .select('order_code created_at shop_id financial_breakdown payment_status order_status')
                    .lean(),
                Order.aggregate([
                    { $match: { payment_status: 'REFUNDED', created_at: { $gte: from, $lt: to } } },
                    { $group: { _id: null, orders: { $sum: 1 }, gmv: money('subtotal'), commission: money('platform_fee') } },
                ]),
                CommissionSetting.getPercent(),
            ]);

        // Tên shop cho cả bảng xếp hạng lẫn danh sách giao dịch — tra một lượt.
        const shopIds = [
            ...new Set([
                ...shopAgg.map((s: any) => String(s._id)),
                ...recentDocs.map((o: any) => String(o.shop_id)),
            ].filter(Boolean)),
        ];
        const shops = shopIds.length
            ? await Shop.find({ _id: { $in: shopIds } }).select('shop_name').lean<{ _id: any; shop_name: string }[]>()
            : [];
        const shopNameById = new Map(shops.map(s => [s._id.toString(), s.shop_name]));

        // Lấp ngày trống: biểu đồ phải liên tục, ngày không có đơn là 0 chứ không phải bỏ cột.
        const byDate = new Map(dailyAgg.map((d: any) => [d._id, d]));
        const daily: FinanceOverview['daily'] = [];
        for (let i = period - 1; i >= 0; i--) {
            const date = new Date(to.getTime() - i * DAY_MS).toLocaleDateString('en-CA', { timeZone: VN_TIMEZONE });
            const hit: any = byDate.get(date);
            daily.push({
                date,
                gmv: Math.round(hit?.gmv || 0),
                commission: Math.round(hit?.commission || 0),
                orders: hit?.orders || 0,
            });
        }

        const refunded = refundedAgg[0];
        return {
            period: { days: period, from: from.toISOString(), to: to.toISOString() },
            current: round(currentAgg[0]),
            previous: round(previousAgg[0]),
            daily,
            topShops: shopAgg.map((s: any) => ({
                shopId: String(s._id),
                name: shopNameById.get(String(s._id)) || 'Gian hàng đã xoá',
                orders: s.orders,
                gmv: Math.round(s.gmv || 0),
                commission: Math.round(s.commission || 0),
            })),
            recent: recentDocs.map((o: any) => ({
                orderCode: o.order_code,
                createdAt: new Date(o.created_at).toISOString(),
                shopName: shopNameById.get(String(o.shop_id)) || '—',
                gmv: Math.round(Number(o.financial_breakdown?.subtotal) || 0),
                commission: Math.round(Number(o.financial_breakdown?.platform_fee) || 0),
                payout: Math.round(Number(o.financial_breakdown?.seller_payout_amount) || 0),
                paymentStatus: o.payment_status,
                orderStatus: o.order_status,
            })),
            refunded: {
                orders: refunded?.orders || 0,
                gmv: Math.round(refunded?.gmv || 0),
                commission: Math.round(refunded?.commission || 0),
            },
            commissionPercent,
        };
    }

    async getCommissionOverview(): Promise<CommissionOverview> {
        const periodDays = COMMISSION_IMPACT_PERIOD_DAYS;
        const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

        const [detail, agg, activeProducts, activeShops] = await Promise.all([
            CommissionSetting.getDetail(),
            // BR-141: tiền chỉ được cộng từ đơn ĐÃ THANH TOÁN. Đơn chờ thanh toán vẫn đếm vào
            // orderCount để admin biết bối cảnh, nhưng không được góp một đồng nào vào số tiền —
            // gộp vào là thổi doanh thu lên gần 3 lần và lệch hẳn với trang Thống kê thu nhập.
            Order.aggregate<{ orderCount: number; paidOrderCount: number; grossTotal: number; feeTotal: number }>([
                { $match: { created_at: { $gte: since } } },
                {
                    $group: {
                        _id: null,
                        orderCount: { $sum: 1 },
                        paidOrderCount: { $sum: { $cond: [PAID_COND, 1, 0] } },
                        grossTotal: { $sum: { $cond: [PAID_COND, { $toDouble: '$financial_breakdown.subtotal' }, 0] } },
                        feeTotal: { $sum: { $cond: [PAID_COND, { $toDouble: '$financial_breakdown.platform_fee' }, 0] } },
                    },
                },
            ]),
            Product.countDocuments({ listing_status: 'ACTIVE', is_hidden: { $ne: true } }),
            Shop.countDocuments({}),
        ]);

        const totals = agg[0] || { orderCount: 0, paidOrderCount: 0, grossTotal: 0, feeTotal: 0 };

        // Mỗi luật đang chi phối bao nhiêu sản phẩm? Admin cần biết trước khi sửa một luật là
        // nó chạm vào bao nhiêu mặt hàng, và còn bao nhiêu sản phẩm đang rơi vào mức mặc định.
        // ponytail: quét tuyến tính sản phẩm × luật. Vài nghìn sản phẩm vẫn trong vài chục ms;
        // lớn hơn thì gom theo cặp (danh mục, loại) bằng aggregate rồi mới tra luật.
        const [liveProducts, categories] = await Promise.all([
            Product.find({ listing_status: 'ACTIVE', is_hidden: { $ne: true } })
                .select('category_ids product_type')
                .lean<{ category_ids?: any[]; product_type?: string }[]>(),
            Category.find({}).select('name').sort({ sort_order: 1, name: 1 }).lean<{ _id: any; name: string }[]>(),
        ]);

        const countByRuleId = new Map<string, number>();
        const countByCategory = new Map<string, number>();
        let defaultProductCount = 0;
        for (const p of liveProducts) {
            const categoryId = p.category_ids?.[0] ? String(p.category_ids[0]) : null;
            if (categoryId) countByCategory.set(categoryId, (countByCategory.get(categoryId) || 0) + 1);
            const hit = pickCommissionRule(detail.rules, categoryId, p.product_type || null);
            if (hit) countByRuleId.set(hit.id, (countByRuleId.get(hit.id) || 0) + 1);
            else defaultProductCount++;
        }

        const categoryNameById = new Map(categories.map(c => [c._id.toString(), c.name]));

        // Tra tên người đổi một lượt, không phải mỗi dòng một truy vấn.
        const changerIds = [...new Set(detail.history.map(h => h.changedBy).filter((id): id is string => Boolean(id)))];
        const changers = changerIds.length
            ? await User.find({ _id: { $in: changerIds } }).select('email').lean<{ _id: any; email: string }[]>()
            : [];
        const emailById = new Map(changers.map(u => [u._id.toString(), u.email]));

        return {
            percent: detail.percent,
            updatedAt: detail.updatedAt,
            rules: detail.rules
                .map(r => ({
                    ...r,
                    categoryName: r.categoryId ? categoryNameById.get(r.categoryId) ?? 'Danh mục đã xoá' : null,
                    productCount: countByRuleId.get(r.id) || 0,
                }))
                // Luật cụ thể lên trước, giống đúng thứ tự hệ thống tra.
                .sort((a, b) => (b.categoryId ? 2 : 0) + (b.productType ? 1 : 0) - ((a.categoryId ? 2 : 0) + (a.productType ? 1 : 0))),
            defaultProductCount,
            categories: categories.map(c => ({
                id: c._id.toString(),
                name: c.name,
                productCount: countByCategory.get(c._id.toString()) || 0,
            })),
            history: detail.history.map(h => ({
                ...h,
                changedByEmail: h.changedBy ? emailById.get(h.changedBy) ?? null : null,
            })),
            impact: {
                periodDays,
                orderCount: totals.orderCount,
                paidOrderCount: totals.paidOrderCount,
                netTotal: Math.round(totals.grossTotal - totals.feeTotal),
                feeTotal: Math.round(totals.feeTotal),
                activeProducts,
                activeShops,
            },
        };
    }
}

export const adminService: IAdminService = new AdminService();
