import mongoose from 'mongoose';
import { Shop } from '../../modules/product/infrastructure/models/shop.model';
import { Product } from '../../modules/product/infrastructure/models/product.model';
import { ProductVariant } from '../../modules/product/infrastructure/models/product-variant.model';
import { Coupon } from '../../modules/promotion/infrastructure/models/coupon.model';
import { logger } from './logger';

export async function seedDatabase() {
    try {
        const couponCount = await Coupon.countDocuments();
        if (couponCount === 0) {
            logger.info('Seeding MongoDB initial coupons...');
            await Coupon.create([
                { code: 'VCP50K', discount_type: 'FIXED_AMOUNT', discount_value: mongoose.Types.Decimal128.fromString('50000'), min_order_value: mongoose.Types.Decimal128.fromString('200000'), start_date: new Date(), end_date: new Date(Date.now() + 30 * 86400000) },
                { code: 'VCPFREE', discount_type: 'FIXED_AMOUNT', discount_value: mongoose.Types.Decimal128.fromString('30000'), min_order_value: mongoose.Types.Decimal128.fromString('0'), start_date: new Date(), end_date: new Date(Date.now() + 30 * 86400000) },
                { code: 'VCP100K', discount_type: 'FIXED_AMOUNT', discount_value: mongoose.Types.Decimal128.fromString('100000'), min_order_value: mongoose.Types.Decimal128.fromString('1000000'), start_date: new Date(), end_date: new Date(Date.now() + 30 * 86400000) },
                { code: 'VCP10', discount_type: 'PERCENTAGE', discount_value: mongoose.Types.Decimal128.fromString('10'), min_order_value: mongoose.Types.Decimal128.fromString('0'), start_date: new Date(), end_date: new Date(Date.now() + 30 * 86400000) },
            ]);
        }

        const shopCount = await Shop.countDocuments();
        if (shopCount > 0) {
            logger.info('Database already has shops, skipping shop seeding.');
            return;
        }

        logger.info('Seeding MongoDB initial VietCraft data...');

        // 1. Create Owners / Shop items
        const owner1Id = new mongoose.Types.ObjectId();
        const owner2Id = new mongoose.Types.ObjectId();
        const owner3Id = new mongoose.Types.ObjectId();

        const shop1 = await Shop.create({
            owner_id: owner1Id,
            shop_name: 'Gốm Mộc Studio',
            slug: 'gom-moc-studio',
            logo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
            banner: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&q=80&w=600',
            description: 'Handcrafted Ceramics from Portland, OR',
            average_rating: 5.0,
            listing_count: 5,
        });

        const shop2 = await Shop.create({
            owner_id: owner2Id,
            shop_name: 'Xưởng Da Thủ Công',
            slug: 'xuong-da-thu-cong',
            logo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
            banner: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=600',
            description: 'Bespoke Leather Goods from Austin, TX',
            average_rating: 4.9,
            listing_count: 8,
        });

        const shop3 = await Shop.create({
            owner_id: owner3Id,
            shop_name: 'Tiệm Tranh Kỷ Ức',
            slug: 'tiem-tranh-ky-uc',
            logo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200',
            banner: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&q=80&w=600',
            description: 'Custom art and painting workspace in Denver, CO',
            average_rating: 4.8,
            listing_count: 12,
        });

        const shippingProfileId = new mongoose.Types.ObjectId();

        // 2. Create products
        const p1 = await Product.create({
            shop_id: shop1._id,
            shipping_profile_id: shippingProfileId,
            title: 'Handmade Ceramic Mug',
            description: 'Premium ceramic clay mug with custom earthy glazes.',
            product_type: 'READY_TO_SHIP',
            allow_customization: false,
            images: ['https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&q=80&w=600'],
            categories: ['Trang trí', 'Ly tách'],
            tags: ['clay', 'mug', 'ceramic'],
            weight_g: 350,
            dimensions_cm: { length: 10, width: 10, height: 12 },
            moderation_status: 'APPROVED',
            listing_status: 'ACTIVE',
        });

        const p2 = await Product.create({
            shop_id: shop2._id,
            shipping_profile_id: shippingProfileId,
            title: 'Minimalist Silver Ring',
            description: 'Handcrafted 925 sterling silver minimal ring for daily wear.',
            product_type: 'READY_TO_SHIP',
            allow_customization: true,
            customization_type: 'DIRECT_CHAT',
            images: ['https://images.unsplash.com/photo-1598560917505-59a3ad559071?auto=format&fit=crop&q=80&w=600'],
            categories: ['Phụ kiện', 'Trang sức'],
            tags: ['silver', 'ring', 'minimalist'],
            weight_g: 10,
            dimensions_cm: { length: 2, width: 2, height: 1 },
            moderation_status: 'APPROVED',
            listing_status: 'ACTIVE',
        });

        const p3 = await Product.create({
            shop_id: shop3._id,
            shipping_profile_id: shippingProfileId,
            title: 'Abstract Line Art Print',
            description: 'Boho decor minimal physical art canvas print.',
            product_type: 'READY_TO_SHIP',
            allow_customization: false,
            images: ['https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&q=80&w=600'],
            categories: ['Tranh ảnh', 'Nhà cửa'],
            tags: ['canvas', 'line-art', 'minimalist'],
            weight_g: 150,
            dimensions_cm: { length: 30, width: 40, height: 2 },
            moderation_status: 'APPROVED',
            listing_status: 'ACTIVE',
        });

        const p4 = await Product.create({
            shop_id: shop3._id,
            shipping_profile_id: shippingProfileId,
            title: 'Chunky Knit Throw',
            description: 'Ultra soft hand-woven chunky yarn throw blanket.',
            product_type: 'READY_TO_SHIP',
            allow_customization: false,
            images: ['https://images.unsplash.com/photo-1580301762395-21ce84d00bc6?auto=format&fit=crop&q=80&w=600'],
            categories: ['Nhà cửa', 'Vải len'],
            tags: ['knitted', 'blanket', 'wool'],
            weight_g: 2200,
            dimensions_cm: { length: 50, width: 40, height: 15 },
            moderation_status: 'APPROVED',
            listing_status: 'ACTIVE',
        });

        // 3. Create variants (carrying pricing and stock)
        await ProductVariant.create({
            product_id: p1._id,
            sku: 'MUG-EARTH-01',
            base_cost: mongoose.Types.Decimal128.fromString('400000'),
            retail_price: mongoose.Types.Decimal128.fromString('750000'),
            stock_quantity: 120,
            is_active: true,
        });

        await ProductVariant.create({
            product_id: p2._id,
            sku: 'RING-SILVER-01',
            base_cost: mongoose.Types.Decimal128.fromString('600000'),
            retail_price: mongoose.Types.Decimal128.fromString('1050000'),
            stock_quantity: 94,
            is_active: true,
        });

        await ProductVariant.create({
            product_id: p3._id,
            sku: 'ART-LINE-BOHO',
            base_cost: mongoose.Types.Decimal128.fromString('300000'),
            retail_price: mongoose.Types.Decimal128.fromString('650000'),
            stock_quantity: 215,
            is_active: true,
        });

        await ProductVariant.create({
            product_id: p4._id,
            sku: 'BLKT-KNIT-WOOL',
            base_cost: mongoose.Types.Decimal128.fromString('1500000'),
            retail_price: mongoose.Types.Decimal128.fromString('2800000'),
            stock_quantity: 72,
            is_active: true,
        });

        logger.info('Database seeded successfully.');

    } catch (e: any) {
        logger.error('Database seeding failed: ' + e.message);
    }
}
