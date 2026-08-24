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

        const productCount = await Product.countDocuments();
        if (productCount >= 5) {
            logger.info('Database already contains sufficient products, skipping seeding.');
            return;
        }

        // Clear stale seed data before re-seeding
        await Product.deleteMany({});
        await ProductVariant.deleteMany({});

        // Reuse existing shops or create new ones
        const shopCount = await Shop.countDocuments();
        let shop1: any, shop2: any, shop3: any;

        if (shopCount === 0) {
            logger.info('Seeding MongoDB shops...');
            shop1 = await Shop.create({
                owner_id: new mongoose.Types.ObjectId(),
                shop_name: 'Gốm Mộc Studio',
                slug: 'gom-moc-studio',
                logo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
                banner: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&q=80&w=600',
                description: 'Đồ gốm thủ công từ Hà Nội',
                average_rating: 5.0,
                listing_count: 5,
            });
            shop2 = await Shop.create({
                owner_id: new mongoose.Types.ObjectId(),
                shop_name: 'Xưởng Da Thủ Công',
                slug: 'xuong-da-thu-cong',
                logo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
                banner: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=600',
                description: 'Phụ kiện da cao cấp từ TP.HCM',
                average_rating: 4.9,
                listing_count: 8,
            });
            shop3 = await Shop.create({
                owner_id: new mongoose.Types.ObjectId(),
                shop_name: 'Tiệm Tranh Kỷ Ức',
                slug: 'tiem-tranh-ky-uc',
                logo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200',
                banner: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&q=80&w=600',
                description: 'Tranh nghệ thuật handmade từ Đà Lạt',
                average_rating: 4.8,
                listing_count: 12,
            });
        } else {
            const shops = await Shop.find().limit(3);
            shop1 = shops[0];
            shop2 = shops[1] || shops[0];
            shop3 = shops[2] || shops[0];
        }

        logger.info('Seeding MongoDB products...');
        const spId = new mongoose.Types.ObjectId();

        // ── Thời trang
        const p1 = await Product.create({
            shop_id: shop1._id,
            shipping_profile_id: spId,
            title: 'Áo thun Minimalist Geometric Heavyweight Cotton',
            description: 'Áo thun cotton 100% 250gsm với họa tiết hình học tối giản. Chất vải mềm mại, thoáng mát, chuẩn form streetwear.',
            product_type: 'POD_TEMPLATE',
            allow_customization: true,
            customization_type: 'DIRECT_CHAT',
            images: [
                'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&q=80&w=600',
                'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&q=80&w=600',
            ],
            categories: ['Áo thun (T-Shirt)', 'Thời trang'],
            tags: ['TP.HCM', 't-shirt', 'cotton', 'minimalist'],
            weight_g: 250,
            dimensions_cm: { length: 30, width: 25, height: 2 },
            stock_alert_threshold: 1,
            moderation_status: 'APPROVED',
            listing_status: 'ACTIVE',
            rejection_reason: '220000',
        });

        const p2 = await Product.create({
            shop_id: shop2._id,
            shipping_profile_id: spId,
            title: 'Áo thun Retro Line Art Vintage',
            description: 'Áo thun họa tiết line art phong cách retro. In DTG chất lượng cao, không phai màu.',
            product_type: 'POD_TEMPLATE',
            allow_customization: false,
            customization_type: 'NONE',
            images: [
                'https://images.unsplash.com/photo-1503341504253-dff4815485f1?auto=format&fit=crop&q=80&w=600',
                'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&q=80&w=600',
            ],
            categories: ['Áo thun (T-Shirt)', 'Thời trang'],
            tags: ['Hà Nội', 't-shirt', 'retro', 'art'],
            weight_g: 200,
            dimensions_cm: { length: 30, width: 25, height: 2 },
            stock_alert_threshold: 2,
            moderation_status: 'APPROVED',
            listing_status: 'ACTIVE',
            rejection_reason: '290000',
        });

        const p3 = await Product.create({
            shop_id: shop3._id,
            shipping_profile_id: spId,
            title: 'Áo Hoodie Premium Nỉ Bông Chân Cua',
            description: 'Hoodie nỉ bông dày dặn 380gsm với hoạ tiết nghệ thuật độc đáo. Giữ ấm tốt, kiểu dáng rộng rãi streetwear.',
            product_type: 'POD_TEMPLATE',
            allow_customization: true,
            customization_type: 'ONLINE_MOCKUP',
            images: [
                'https://images.unsplash.com/photo-1556821840-3a63f15732ce?auto=format&fit=crop&q=80&w=600',
                'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&q=80&w=600',
            ],
            categories: ['Áo Hoodie & Nỉ', 'Thời trang'],
            tags: ['Đà Lạt', 'hoodie', 'streetwear'],
            weight_g: 650,
            dimensions_cm: { length: 35, width: 30, height: 5 },
            stock_alert_threshold: 3,
            moderation_status: 'APPROVED',
            listing_status: 'ACTIVE',
            rejection_reason: '380000',
        });

        const p4 = await Product.create({
            shop_id: shop2._id,
            shipping_profile_id: spId,
            title: 'Túi Tote Canvas Mộc Abstract Eco',
            description: 'Túi tote vải bố canvas mộc tự nhiên 12oz, có khóa kéo miệng và in họa tiết nghệ thuật độc quyền.',
            product_type: 'POD_TEMPLATE',
            allow_customization: true,
            customization_type: 'ONLINE_MOCKUP',
            images: [
                'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=600&q=80',
                'https://images.unsplash.com/photo-1622560480605-d83c853bc5c3?auto=format&fit=crop&q=80&w=600',
            ],
            categories: ['Túi Tote & Canvas', 'Phụ kiện'],
            tags: ['TP.HCM', 'canvas', 'eco', 'tote'],
            weight_g: 180,
            dimensions_cm: { length: 38, width: 35, height: 1 },
            stock_alert_threshold: 4,
            moderation_status: 'APPROVED',
            listing_status: 'ACTIVE',
            rejection_reason: '110000',
        });

        const p5 = await Product.create({
            shop_id: shop1._id,
            shipping_profile_id: spId,
            title: 'Ly Gốm Mộc Men Lam Thủ Công',
            description: 'Ly gốm thủ công Bát Tràng tráng men lam tự nhiên. Giữ nhiệt tốt, an toàn cho sức khỏe.',
            product_type: 'READY_TO_SHIP',
            allow_customization: false,
            customization_type: 'NONE',
            images: [
                'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&q=80&w=600',
            ],
            categories: ['Gốm sứ & Mỹ nghệ', 'Nhà cửa'],
            tags: ['Hà Nội', 'ceramic', 'handmade'],
            weight_g: 350,
            dimensions_cm: { length: 12, width: 12, height: 12 },
            stock_alert_threshold: 5,
            moderation_status: 'APPROVED',
            listing_status: 'ACTIVE',
            rejection_reason: '250000',
        });

        // ── Variants
        await ProductVariant.create([
            {
                product_id: p1._id,
                sku: 'VC-PRD-TSHIRT-BLK',
                color: 'Đen (Black)',
                size: 'L',
                mockup_image: '#1C1C1C',
                base_cost: mongoose.Types.Decimal128.fromString('110000'),
                retail_price: mongoose.Types.Decimal128.fromString('165000'),
                stock_quantity: 60,
                is_active: true
            },
            {
                product_id: p1._id,
                sku: 'VC-PRD-TSHIRT-WHT',
                color: 'Trắng (White)',
                size: 'M',
                mockup_image: '#F9FAFB',
                base_cost: mongoose.Types.Decimal128.fromString('110000'),
                retail_price: mongoose.Types.Decimal128.fromString('165000'),
                stock_quantity: 40,
                is_active: true
            },
            {
                product_id: p2._id,
                sku: 'VC-PRD-RETRO-WHT',
                color: 'Trắng (White)',
                size: 'L',
                mockup_image: '#F9FAFB',
                base_cost: mongoose.Types.Decimal128.fromString('130000'),
                retail_price: mongoose.Types.Decimal128.fromString('219000'),
                stock_quantity: 50,
                is_active: true
            },
            {
                product_id: p3._id,
                sku: 'VC-PRD-HOODIE-GRY',
                color: 'Xám tiêu (Grey Melange)',
                size: 'XL',
                mockup_image: '#6B7280',
                base_cost: mongoose.Types.Decimal128.fromString('210000'),
                retail_price: mongoose.Types.Decimal128.fromString('295000'),
                stock_quantity: 45,
                is_active: true
            },
            {
                product_id: p3._id,
                sku: 'VC-PRD-HOODIE-BLK',
                color: 'Đen tuyền',
                size: 'L',
                mockup_image: '#1C1C1C',
                base_cost: mongoose.Types.Decimal128.fromString('210000'),
                retail_price: mongoose.Types.Decimal128.fromString('295000'),
                stock_quantity: 35,
                is_active: true
            },
            {
                product_id: p4._id,
                sku: 'VC-PRD-TOTE-NAT',
                color: 'Canvas Mộc Tự Nhiên',
                mockup_image: '#E6D7B9',
                base_cost: mongoose.Types.Decimal128.fromString('45000'),
                retail_price: mongoose.Types.Decimal128.fromString('79000'),
                stock_quantity: 80,
                is_active: true
            },
            {
                product_id: p5._id,
                sku: 'VC-PRD-MUG-BLU',
                color: 'Men Lam Cổ Điển',
                mockup_image: '#1D4ED8',
                base_cost: mongoose.Types.Decimal128.fromString('90000'),
                retail_price: mongoose.Types.Decimal128.fromString('180000'),
                stock_quantity: 30,
                is_active: true
            }
        ]);

        logger.info('Database seeded successfully with initial products, shops, and coupons.');
    } catch (e: any) {
        logger.error('Database seeding failed: ' + (e.message || e));
    }
}
