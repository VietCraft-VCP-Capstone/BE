import mongoose from 'mongoose';
import { Coupon, ICoupon, CouponDiscountType } from '../infrastructure/models/coupon.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { Product } from '../../product/infrastructure/models/product.model';

export const dec = (n: number) => mongoose.Types.Decimal128.fromString(Math.round(n || 0).toString());
export const num = (v: any) => (v ? Number(v.toString()) : 0);

export interface ApplyCouponResult {
    valid: boolean;
    discount: number;
    target: 'PRODUCT' | 'SHIPPING';
    message?: string;
    coupon?: {
        id: string;
        code: string;
        title: string;
        description?: string;
        discount_type: CouponDiscountType;
        discount_value: number;
        min_order_value?: number;
        max_discount_amount?: number;
        shop_id?: string | null;
        is_platform: boolean;
    };
}

export interface CreateCouponInput {
    code: string;
    title: string;
    description?: string;
    discount_type: CouponDiscountType;
    discount_value: number;
    min_order_value?: number;
    max_discount_amount?: number;
    usage_limit?: number;
    start_date: string | Date;
    end_date: string | Date;
}

export class PromotionService {
    private static async getSellerShopId(ownerId: string): Promise<mongoose.Types.ObjectId> {
        if (!mongoose.Types.ObjectId.isValid(ownerId)) {
            throw new Error('Phiên đăng nhập không hợp lệ');
        }
        const shop = await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(ownerId) }).select('_id').lean();
        if (!shop) {
            throw new Error('Bạn chưa thiết lập thông tin gian hàng.');
        }
        return shop._id as mongoose.Types.ObjectId;
    }

    /**
     * Kiểm tra tính hợp lệ và tính toán số tiền giảm cho đơn hàng
     */
    static async validateAndApply(
        code: string,
        subtotal: number,
        shippingFee: number = 0,
        shopId?: string | mongoose.Types.ObjectId,
        productId?: string
    ): Promise<ApplyCouponResult> {
        if (!code || !code.trim()) {
            return { valid: false, discount: 0, target: 'PRODUCT', message: 'Vui lòng nhập mã giảm giá' };
        }

        // Tự động phân giải shopId từ productId nếu chưa có shopId
        if (!shopId && productId && mongoose.Types.ObjectId.isValid(productId)) {
            const product = await Product.findById(productId).select('shop_id').lean();
            if (product?.shop_id) {
                shopId = product.shop_id as mongoose.Types.ObjectId;
            }
        }


        const cleanCode = code.trim().toUpperCase();
        const coupon = await Coupon.findOne({ code: cleanCode, is_active: true }).lean();

        if (!coupon) {
            return { valid: false, discount: 0, target: 'PRODUCT', message: 'Mã giảm giá không tồn tại hoặc đã ngừng hoạt động.' };
        }

        const now = new Date();
        const startDate = new Date(coupon.start_date);
        const endDate = new Date(coupon.end_date);

        if (now < startDate) {
            return {
                valid: false,
                discount: 0,
                target: 'PRODUCT',
                message: `Chương trình khuyến mãi chỉ bắt đầu từ ${startDate.toLocaleDateString('vi-VN')} ${startDate.toLocaleTimeString('vi-VN')}.`
            };
        }

        if (now > endDate) {
            return {
                valid: false,
                discount: 0,
                target: 'PRODUCT',
                message: 'Mã giảm giá đã hết hạn sử dụng.'
            };
        }

        if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
            return {
                valid: false,
                discount: 0,
                target: 'PRODUCT',
                message: 'Mã giảm giá đã hết lượt sử dụng.'
            };
        }

        // Kiểm tra phạm vi áp dụng (Shop voucher vs Platform voucher)
        if (coupon.shop_id) {
            if (!shopId || coupon.shop_id.toString() !== shopId.toString()) {
                const shop = await Shop.findById(coupon.shop_id).select('shop_name').lean();
                const shopName = shop?.shop_name || 'gian hàng chỉ định';
                return {
                    valid: false,
                    discount: 0,
                    target: 'PRODUCT',
                    message: `Mã giảm giá này chỉ áp dụng cho sản phẩm của ${shopName}.`
                };
            }
        }

        const minOrderValue = num(coupon.min_order_value);
        if (minOrderValue > 0 && subtotal < minOrderValue) {
            const diff = minOrderValue - subtotal;
            return {
                valid: false,
                discount: 0,
                target: 'PRODUCT',
                message: `Đơn hàng tối thiểu phải từ ${minOrderValue.toLocaleString('vi-VN')}đ (cần mua thêm ${diff.toLocaleString('vi-VN')}đ để áp dụng).`
            };
        }

        const discountVal = num(coupon.discount_value);
        const maxDiscount = num(coupon.max_discount_amount);
        let discount = 0;
        let target: 'PRODUCT' | 'SHIPPING' = 'PRODUCT';

        switch (coupon.discount_type) {
            case 'PERCENTAGE': {
                const rawDiscount = subtotal * (discountVal / 100);
                const cappedDiscount = maxDiscount > 0 ? Math.min(rawDiscount, maxDiscount) : rawDiscount;
                discount = Math.min(Math.round(cappedDiscount), subtotal);
                target = 'PRODUCT';
                break;
            }
            case 'FIXED_AMOUNT': {
                discount = Math.min(Math.round(discountVal), subtotal);
                target = 'PRODUCT';
                break;
            }
            case 'FREE_SHIPPING': {
                const maxShipDiscount = discountVal > 0 ? discountVal : shippingFee;
                discount = Math.min(Math.round(maxShipDiscount), shippingFee);
                target = 'SHIPPING';
                break;
            }
            case 'FLASH_SALE': {
                if (discountVal <= 100) {
                    const raw = subtotal * (discountVal / 100);
                    const capped = maxDiscount > 0 ? Math.min(raw, maxDiscount) : raw;
                    discount = Math.min(Math.round(capped), subtotal);
                } else {
                    discount = Math.min(Math.round(discountVal), subtotal);
                }
                target = 'PRODUCT';
                break;
            }
            case 'BUNDLE': {
                if (discountVal <= 100) {
                    const raw = subtotal * (discountVal / 100);
                    const capped = maxDiscount > 0 ? Math.min(raw, maxDiscount) : raw;
                    discount = Math.min(Math.round(capped), subtotal);
                } else {
                    discount = Math.min(Math.round(discountVal), subtotal);
                }
                target = 'PRODUCT';
                break;
            }
        }

        return {
            valid: true,
            discount,
            target,
            message: `Áp dụng thành công! Giảm ${discount.toLocaleString('vi-VN')}đ`,
            coupon: {
                id: coupon._id.toString(),
                code: coupon.code,
                title: coupon.title,
                description: coupon.description,
                discount_type: coupon.discount_type,
                discount_value: discountVal,
                min_order_value: minOrderValue,
                max_discount_amount: maxDiscount,
                shop_id: coupon.shop_id ? coupon.shop_id.toString() : null,
                is_platform: !coupon.shop_id
            }
        };
    }

    /**
     * Lấy danh sách voucher khả dụng khi người mua chuẩn bị checkout
     */
    static async getAvailableCoupons(shopId?: string, subtotal: number = 0, productId?: string) {
        if (!shopId && productId && mongoose.Types.ObjectId.isValid(productId)) {
            const product = await Product.findById(productId).select('shop_id').lean();
            if (product?.shop_id) {
                shopId = product.shop_id.toString();
            }
        }

        const now = new Date();
        const shopQuery = shopId && mongoose.Types.ObjectId.isValid(shopId)
            ? { $or: [{ shop_id: null }, { shop_id: new mongoose.Types.ObjectId(shopId) }] }
            : { shop_id: null };


        const coupons = await Coupon.find({
            ...shopQuery,
            is_active: true,
            start_date: { $lte: now },
            end_date: { $gte: now },
            $or: [
                { usage_limit: null },
                { $expr: { $lt: ['$used_count', '$usage_limit'] } }
            ]
        }).populate('shop_id', 'shop_name logo').sort({ end_date: 1 }).lean();

        return coupons.map(c => {
            const minOrder = num(c.min_order_value);
            const isEligible = subtotal >= minOrder;
            const shopObj: any = c.shop_id;

            return {
                id: c._id.toString(),
                code: c.code,
                title: c.title,
                description: c.description,
                discount_type: c.discount_type,
                discount_value: num(c.discount_value),
                min_order_value: minOrder,
                max_discount_amount: num(c.max_discount_amount),
                usage_limit: c.usage_limit,
                used_count: c.used_count,
                start_date: c.start_date,
                end_date: c.end_date,
                is_platform: !c.shop_id,
                shop_name: shopObj?.shop_name || 'Toàn sàn VietCraft',
                shop_logo: shopObj?.logo,
                is_eligible: isEligible,
                min_order_diff: isEligible ? 0 : Math.max(0, minOrder - subtotal)
            };
        });
    }

    /**
     * Tăng số lần sử dụng sau khi đơn hàng tạo thành công
     */
    static async recordUsage(code: string) {
        if (!code) return;
        await Coupon.findOneAndUpdate(
            { code: code.trim().toUpperCase() },
            { $inc: { used_count: 1 } }
        );
    }

    // ==========================================
    // SELLER PROMOTION MANAGEMENT
    // ==========================================
    static async listSellerCoupons(ownerId: string) {
        const shopId = await this.getSellerShopId(ownerId);
        const coupons = await Coupon.find({ shop_id: shopId }).sort({ created_at: -1 }).lean();

        return coupons.map(c => ({
            id: c._id.toString(),
            code: c.code,
            title: c.title,
            description: c.description,
            discount_type: c.discount_type,
            discount_value: num(c.discount_value),
            min_order_value: num(c.min_order_value),
            max_discount_amount: num(c.max_discount_amount),
            usage_limit: c.usage_limit,
            used_count: c.used_count,
            start_date: c.start_date,
            end_date: c.end_date,
            is_active: c.is_active,
            created_at: c.created_at
        }));
    }

    private static validateCouponInput(input: CreateCouponInput) {
        const cleanCode = input.code ? input.code.trim().toUpperCase() : '';

        if (!cleanCode) {
            throw new Error('Vui lòng nhập mã giảm giá.');
        }

        const codeRegex = /^[A-Z0-9_]{3,20}$/;
        if (!codeRegex.test(cleanCode)) {
            throw new Error('Mã giảm giá chỉ được chứa chữ cái in hoa (A-Z), số (0-9) và dấu gạch dưới (_), độ dài từ 3 đến 20 ký tự.');
        }

        const title = input.title ? input.title.trim() : '';
        if (title.length < 3 || title.length > 100) {
            throw new Error('Tiêu đề chương trình phải từ 3 đến 100 ký tự.');
        }

        const discountVal = Number(input.discount_value);
        if (isNaN(discountVal) || discountVal <= 0) {
            throw new Error('Giá trị giảm giá phải lớn hơn 0.');
        }

        if (input.discount_type === 'PERCENTAGE') {
            if (discountVal < 1 || discountVal > 100) {
                throw new Error('Phần trăm giảm giá phải nằm trong khoảng từ 1% đến 100%.');
            }
        }

        const minOrder = input.min_order_value !== undefined ? Number(input.min_order_value) : undefined;
        if (minOrder !== undefined && minOrder < 0) {
            throw new Error('Giá trị đơn hàng tối thiểu không thể là số âm.');
        }

        if (input.discount_type === 'FIXED_AMOUNT' && minOrder && minOrder > 0) {
            if (discountVal >= minOrder) {
                throw new Error(`Số tiền giảm giá (${discountVal.toLocaleString('vi-VN')}đ) phải nhỏ hơn giá trị đơn hàng tối thiểu (${minOrder.toLocaleString('vi-VN')}đ).`);
            }
        }

        const startDate = new Date(input.start_date);
        const endDate = new Date(input.end_date);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            throw new Error('Thời gian bắt đầu hoặc kết thúc không hợp lệ.');
        }

        if (endDate <= startDate) {
            throw new Error('Thời gian kết thúc phải diễn ra sau thời gian bắt đầu.');
        }

        if (input.usage_limit !== undefined && input.usage_limit !== null) {
            const limit = Number(input.usage_limit);
            if (isNaN(limit) || limit < 1) {
                throw new Error('Giới hạn số lượt sử dụng phải là số nguyên lớn hơn hoặc bằng 1.');
            }
        }
    }

    static async createSellerCoupon(ownerId: string, input: CreateCouponInput) {
        this.validateCouponInput(input);
        const shopId = await this.getSellerShopId(ownerId);
        const cleanCode = input.code.trim().toUpperCase();

        const existing = await Coupon.findOne({ code: cleanCode }).lean();
        if (existing) {
            throw new Error(`Mã giảm giá "${cleanCode}" đã tồn tại trên hệ thống. Vui lòng chọn mã khác.`);
        }

        const coupon = await Coupon.create({
            shop_id: shopId,
            code: cleanCode,
            title: input.title.trim(),
            description: input.description?.trim(),
            discount_type: input.discount_type,
            discount_value: dec(input.discount_value),
            min_order_value: input.min_order_value ? dec(input.min_order_value) : null,
            max_discount_amount: input.max_discount_amount ? dec(input.max_discount_amount) : null,
            usage_limit: input.usage_limit ? Number(input.usage_limit) : null,
            used_count: 0,
            start_date: new Date(input.start_date),
            end_date: new Date(input.end_date),
            is_active: true
        });

        return {
            id: coupon._id.toString(),
            code: coupon.code,
            title: coupon.title,
            description: coupon.description,
            discount_type: coupon.discount_type,
            discount_value: num(coupon.discount_value),
            min_order_value: num(coupon.min_order_value),
            max_discount_amount: num(coupon.max_discount_amount),
            usage_limit: coupon.usage_limit,
            used_count: coupon.used_count,
            start_date: coupon.start_date,
            end_date: coupon.end_date,
            is_active: coupon.is_active,
            created_at: coupon.created_at
        };
    }

    static async toggleSellerCoupon(ownerId: string, couponId: string) {
        const shopId = await this.getSellerShopId(ownerId);
        const coupon = await Coupon.findOne({ _id: couponId, shop_id: shopId });
        if (!coupon) throw new Error('Không tìm thấy mã giảm giá');

        coupon.is_active = !coupon.is_active;
        await coupon.save();
        return {
            id: coupon._id.toString(),
            code: coupon.code,
            is_active: coupon.is_active
        };
    }

    static async deleteSellerCoupon(ownerId: string, couponId: string) {
        const shopId = await this.getSellerShopId(ownerId);
        const coupon = await Coupon.findOne({ _id: couponId, shop_id: shopId });
        if (!coupon) throw new Error('Không tìm thấy mã giảm giá');

        if (coupon.used_count > 0) {
            throw new Error(`Mã này đã được sử dụng trong ${coupon.used_count} đơn hàng. Để đảm bảo toàn vẹn dữ liệu đối soát tài chính, bạn chỉ có thể TẮT mã thay vì Xóa.`);
        }

        await Coupon.findByIdAndDelete(couponId);
        return { success: true };
    }

    // ==========================================
    // ADMIN PROMOTION MANAGEMENT
    // ==========================================
    static async listAdminCoupons() {
        const coupons = await Coupon.find()
            .populate('shop_id', 'shop_name')
            .sort({ created_at: -1 })
            .lean();

        return coupons.map(c => {
            const shopObj: any = c.shop_id;
            return {
                id: c._id.toString(),
                code: c.code,
                title: c.title,
                description: c.description,
                discount_type: c.discount_type,
                discount_value: num(c.discount_value),
                min_order_value: num(c.min_order_value),
                max_discount_amount: num(c.max_discount_amount),
                usage_limit: c.usage_limit,
                used_count: c.used_count,
                start_date: c.start_date,
                end_date: c.end_date,
                is_active: c.is_active,
                is_platform: !c.shop_id,
                shop_id: c.shop_id ? c.shop_id.toString() : null,
                shop_name: shopObj?.shop_name || 'Toàn sàn VietCraft',
                created_at: c.created_at
            };
        });
    }

    static async createAdminCoupon(input: CreateCouponInput & { shop_id?: string | null }) {
        this.validateCouponInput(input);
        const cleanCode = input.code.trim().toUpperCase();

        const existing = await Coupon.findOne({ code: cleanCode }).lean();
        if (existing) {
            throw new Error(`Mã giảm giá "${cleanCode}" đã tồn tại trên hệ thống. Vui lòng chọn mã khác.`);
        }

        const targetShopId = input.shop_id && mongoose.Types.ObjectId.isValid(input.shop_id)
            ? new mongoose.Types.ObjectId(input.shop_id)
            : null;

        const coupon = await Coupon.create({
            shop_id: targetShopId,
            code: cleanCode,
            title: input.title.trim(),
            description: input.description?.trim(),
            discount_type: input.discount_type,
            discount_value: dec(input.discount_value),
            min_order_value: input.min_order_value ? dec(input.min_order_value) : null,
            max_discount_amount: input.max_discount_amount ? dec(input.max_discount_amount) : null,
            usage_limit: input.usage_limit ? Number(input.usage_limit) : null,
            used_count: 0,
            start_date: new Date(input.start_date),
            end_date: new Date(input.end_date),
            is_active: true
        });

        return {
            id: coupon._id.toString(),
            code: coupon.code,
            title: coupon.title,
            description: coupon.description,
            discount_type: coupon.discount_type,
            discount_value: num(coupon.discount_value),
            min_order_value: num(coupon.min_order_value),
            max_discount_amount: num(coupon.max_discount_amount),
            usage_limit: coupon.usage_limit,
            used_count: coupon.used_count,
            start_date: coupon.start_date,
            end_date: coupon.end_date,
            is_active: coupon.is_active,
            is_platform: !coupon.shop_id,
            shop_id: coupon.shop_id ? coupon.shop_id.toString() : null,
            created_at: coupon.created_at
        };
    }

    static async toggleAdminCoupon(couponId: string) {
        const coupon = await Coupon.findById(couponId);
        if (!coupon) throw new Error('Không tìm thấy mã giảm giá');

        coupon.is_active = !coupon.is_active;
        await coupon.save();
        return {
            id: coupon._id.toString(),
            code: coupon.code,
            is_active: coupon.is_active
        };
    }

    static async deleteAdminCoupon(couponId: string) {
        const coupon = await Coupon.findById(couponId);
        if (!coupon) throw new Error('Không tìm thấy mã giảm giá');

        if (coupon.used_count > 0) {
            throw new Error(`Voucher này đã được sử dụng trong ${coupon.used_count} đơn hàng. Để đảm bảo đối soát tài chính, bạn chỉ có thể TẮT mã thay vì Xóa.`);
        }

        await Coupon.findByIdAndDelete(couponId);
        return { success: true };
    }
}

