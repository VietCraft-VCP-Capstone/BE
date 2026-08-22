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

        // Check by product count — re-seed if fewer than 10 products exist
        const productCount = await Product.countDocuments();
        if (productCount >= 10) {
            logger.info('Database already has sufficient products, skipping seeding.');
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
                average_rating: 5.0, listing_count: 5,
            });
            shop2 = await Shop.create({
                owner_id: new mongoose.Types.ObjectId(),
                shop_name: 'Xưởng Da Thủ Công',
                slug: 'xuong-da-thu-cong',
                logo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
                banner: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=600',
                description: 'Phụ kiện da cao cấp từ TP.HCM',
                average_rating: 4.9, listing_count: 8,
            });
            shop3 = await Shop.create({
                owner_id: new mongoose.Types.ObjectId(),
                shop_name: 'Tiệm Tranh Kỷ Ức',
                slug: 'tiem-tranh-ky-uc',
                logo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200',
                banner: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&q=80&w=600',
                description: 'Tranh nghệ thuật handmade từ Đà Lạt',
                average_rating: 4.8, listing_count: 12,
            });
        } else {
            const shops = await Shop.find().limit(3);
            shop1 = shops[0]; shop2 = shops[1] || shops[0]; shop3 = shops[2] || shops[0];
        }

        logger.info('Seeding MongoDB products...');
        const spId = new mongoose.Types.ObjectId();

        // ── Thời trang — 5 sản phẩm cùng category → related products phong phú
        const p1 = await Product.create({
            shop_id: shop1._id, shipping_profile_id: spId,
            title: 'Minimalist Geometric T-Shirt',
            description: 'Áo thun cotton 100% với họa tiết hình học tối giản. Chất vải mềm mại, thoáng mát, phù hợp mặc hàng ngày. Giao hàng trong 3-5 ngày làm việc.',
            product_type: 'READY_TO_SHIP', allow_customization: true, customization_type: 'DIRECT_CHAT',
            images: [
                'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&q=80&w=600',
                'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&q=80&w=600',
                'https://images.unsplash.com/photo-1562157873-818bc0726f68?auto=format&fit=crop&q=80&w=600',
            ],
            categories: ['Thời trang'], tags: ['t-shirt', 'cotton', 'minimalist'],
            weight_g: 200, dimensions_cm: { length: 30, width: 25, height: 2 },
            moderation_status: 'APPROVED', listing_status: 'ACTIVE',
        });
        const p2 = await Product.create({
            shop_id: shop2._id, shipping_profile_id: spId,
            title: 'Retro Line Art T-Shirt',
            description: 'Áo thun họa tiết line art phong cách retro. In chất lượng cao, không ra màu sau nhiều lần giặt.',
            product_type: 'READY_TO_SHIP', allow_customization: false,
            images: [
                'https://images.unsplash.com/photo-1503341504253-dff4815485f1?auto=format&fit=crop&q=80&w=600',
                'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&q=80&w=600',
            ],
            categories: ['Thời trang'], tags: ['t-shirt', 'retro', 'art'],
            weight_g: 200, dimensions_cm: { length: 30, width: 25, height: 2 },
            moderation_status: 'APPROVED', listing_status: 'ACTIVE',
        });
        const p3 = await Product.create({
            shop_id: shop3._id, shipping_profile_id: spId,
            title: 'Premium Linen Art Hoodie',
            description: 'Hoodie vải linen cao cấp với hoạ tiết nghệ thuật độc đáo. Giữ ấm tốt, kiểu dáng rộng rãi streetwear.',
            product_type: 'READY_TO_SHIP', allow_customization: true, customization_type: 'ONLINE_MOCKUP',
            images: [
                'https://images.unsplash.com/photo-1556821840-3a63f15732ce?auto=format&fit=crop&q=80&w=600',
                'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&q=80&w=600',
            ],
            categories: ['Thời trang'], tags: ['hoodie', 'linen', 'streetwear'],
            weight_g: 550, dimensions_cm: { length: 35, width: 28, height: 4 },
            moderation_status: 'APPROVED', listing_status: 'ACTIVE',
        });
        const p4 = await Product.create({
            shop_id: shop1._id, shipping_profile_id: spId,
            title: 'Denim Jacket Custom Print',
            description: 'Áo khoác denim chất lượng cao có thể in tên hoặc thiết kế theo yêu cầu. Tân trang phong cách vintage.',
            product_type: 'CUSTOM_DESIGN_REQUEST', allow_customization: true, customization_type: 'DIRECT_CHAT',
            images: [
                'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&q=80&w=600',
                'https://images.unsplash.com/photo-1548126032-079a0fb0099d?auto=format&fit=crop&q=80&w=600',
            ],
            categories: ['Thời trang'], tags: ['jacket', 'denim', 'custom'],
            weight_g: 800, dimensions_cm: { length: 40, width: 32, height: 5 },
            moderation_status: 'APPROVED', listing_status: 'ACTIVE',
        });
        const p5 = await Product.create({
            shop_id: shop3._id, shipping_profile_id: spId,
            title: 'Crossfit T-Shirt Edition',
            description: 'Áo thể thao chất liệu co giãn 4 chiều, thấm hút tốt. Phù hợp tập gym, yoga, chạy bộ.',
            product_type: 'READY_TO_SHIP', allow_customization: false,
            images: ['https://images.unsplash.com/photo-1544216717-3bbf52512659?auto=format&fit=crop&q=80&w=600'],
            categories: ['Thời trang'], tags: ['sport', 't-shirt', 'gym'],
            weight_g: 180, dimensions_cm: { length: 30, width: 24, height: 2 },
            moderation_status: 'APPROVED', listing_status: 'ACTIVE',
        });

        // ── Phụ kiện — 2 sản phẩm
        const p6 = await Product.create({
            shop_id: shop2._id, shipping_profile_id: spId,
            title: 'Canvas Tote Bag - Abstract',
            description: 'Túi canvas thân thiện môi trường, in hình abstract art độc quyền. Chứa được nhiều đồ, quai vải bền chắc.',
            product_type: 'READY_TO_SHIP', allow_customization: false,
            images: [
                'https://images.unsplash.com/photo-1622560480605-d83c853bc5c3?auto=format&fit=crop&q=80&w=600',
                'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&q=80&w=600',
            ],
            categories: ['Phụ kiện'], tags: ['tote', 'canvas', 'eco'],
            weight_g: 250, dimensions_cm: { length: 40, width: 35, height: 2 },
            moderation_status: 'APPROVED', listing_status: 'ACTIVE',
        });
        const p7 = await Product.create({
            shop_id: shop1._id, shipping_profile_id: spId,
            title: 'Minimalist Silver Ring',
            description: 'Nhẫn bạc 925 thủ công tối giản cho phong cách hàng ngày. Kích thước đa dạng, có thể khắc tên theo yêu cầu.',
            product_type: 'READY_TO_SHIP', allow_customization: true, customization_type: 'DIRECT_CHAT',
            images: ['https://images.unsplash.com/photo-1598560917505-59a3ad559071?auto=format&fit=crop&q=80&w=600'],
            categories: ['Phụ kiện'], tags: ['silver', 'ring', 'minimalist'],
            weight_g: 10, dimensions_cm: { length: 2, width: 2, height: 1 },
            moderation_status: 'APPROVED', listing_status: 'ACTIVE',
        });

        // ── Nhà cửa — 3 sản phẩm
        const p8 = await Product.create({
            shop_id: shop1._id, shipping_profile_id: spId,
            title: 'Handmade Ceramic Mug',
            description: 'Ly gốm thủ công men xanh tự nhiên. Dày dặn, giữ nhiệt tốt, an toàn cho lò vi sóng.',
            product_type: 'READY_TO_SHIP', allow_customization: false,
            images: [
                'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&q=80&w=600',
                'https://images.unsplash.com/photo-1575377427642-087cf684f29d?auto=format&fit=crop&q=80&w=600',
            ],
            categories: ['Nhà cửa'], tags: ['ceramic', 'mug', 'handmade'],
            weight_g: 350, dimensions_cm: { length: 10, width: 10, height: 12 },
            moderation_status: 'APPROVED', listing_status: 'ACTIVE',
        });
        const p9 = await Product.create({
            shop_id: shop3._id, shipping_profile_id: spId,
            title: 'Abstract Line Art Print',
            description: 'Tranh canvas boho minimalist, kích thước 30x40cm. Phù hợp trang trí phòng khách, văn phòng.',
            product_type: 'READY_TO_SHIP', allow_customization: false,
            images: ['https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&q=80&w=600'],
            categories: ['Nhà cửa'], tags: ['canvas', 'art', 'decor'],
            weight_g: 150, dimensions_cm: { length: 30, width: 40, height: 2 },
            moderation_status: 'APPROVED', listing_status: 'ACTIVE',
        });
        const p10 = await Product.create({
            shop_id: shop2._id, shipping_profile_id: spId,
            title: 'Chunky Knit Throw Blanket',
            description: 'Chăn len thủ công sợi chunky siêu mềm. Thiết kế tối giản, hợp với nhiều phong cách nội thất.',
            product_type: 'READY_TO_SHIP', allow_customization: false,
            images: ['https://images.unsplash.com/photo-1580301762395-21ce84d00bc6?auto=format&fit=crop&q=80&w=600'],
            categories: ['Nhà cửa'], tags: ['knit', 'blanket', 'cozy'],
            weight_g: 2200, dimensions_cm: { length: 50, width: 40, height: 15 },
            moderation_status: 'APPROVED', listing_status: 'ACTIVE',
        });

        // ── Variants với color + size đầy đủ cho sản phẩm thời trang ──────────
        const fashionProducts = [p1, p2, p3, p4, p5];
        const fashionPrices = [299000, 259000, 559000, 849000, 319000];
        const fashionColors = [['Trắng', 'Đen'], ['Xám', 'Trắng'], ['Đen', 'Xanh'], ['Đen', 'Nâu'], ['Xanh', 'Đỏ']];
        const fashionSizes = ['S', 'M', 'L', 'XL', '2XL'];

        for (let pi = 0; pi < fashionProducts.length; pi++) {
            const prod = fashionProducts[pi];
            const basePrice = fashionPrices[pi];
            const colors = fashionColors[pi];
            for (const color of colors) {
                for (const size of fashionSizes) {
                    await ProductVariant.create({
                        product_id: prod._id,
                        sku: `${prod._id.toString().slice(-6)}-${color}-${size}`,
                        color, size,
                        base_cost: mongoose.Types.Decimal128.fromString(Math.round(basePrice * 0.6).toString()),
                        retail_price: mongoose.Types.Decimal128.fromString(basePrice.toString()),
                        stock_quantity: Math.floor(Math.random() * 80) + 20,
                        is_active: true,
                    });
                }
            }
        }

        // Variant đơn cho các sản phẩm khác
        const simplePairs: [any, number][] = [
            [p6, 149000], [p7, 399000], [p8, 750000], [p9, 650000], [p10, 2800000],
        ];
        for (const [prod, price] of simplePairs) {
            await ProductVariant.create({
                product_id: prod._id,
                sku: `SKU-${prod._id.toString().slice(-6)}`,
                base_cost: mongoose.Types.Decimal128.fromString(Math.round(price * 0.6).toString()),
                retail_price: mongoose.Types.Decimal128.fromString(price.toString()),
                stock_quantity: Math.floor(Math.random() * 100) + 50,
                is_active: true,
            });
        }

        logger.info('Database seeded successfully with 10 products.');

    } catch (e: any) {
        logger.error('Database seeding failed: ' + e.message);
    }
}
