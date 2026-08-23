import mongoose from 'mongoose';
import { Shop } from '../../modules/product/infrastructure/models/shop.model';
import { Product } from '../../modules/product/infrastructure/models/product.model';
import { ProductVariant } from '../../modules/product/infrastructure/models/product-variant.model';
import { logger } from './logger';

export async function seedDatabase() {
    try {
        const productCount = await Product.countDocuments();
        if (productCount > 0) {
            logger.info('Database already contains products, skipping seeding.');
            return;
        }

        logger.info('Seeding MongoDB with POD apparel products...');

        // 1. Create Shops
        const owner1Id = new mongoose.Types.ObjectId();
        const owner2Id = new mongoose.Types.ObjectId();

        const shop1 = await Shop.create({
            owner_id: owner1Id,
            shop_name: 'Xưởng May & In Ấn Sài Gòn',
            slug: 'xuong-may-in-an-sai-gon',
            logo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
            banner: 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?auto=format&fit=crop&q=80&w=600',
            description: 'Xưởng sản xuất phôi áo và in ấn POD theo yêu cầu tại TP.HCM',
            average_rating: 5.0,
            listing_count: 3,
        });

        const shop2 = await Shop.create({
            owner_id: owner2Id,
            shop_name: 'VietCraft Custom Apparel Studio',
            slug: 'vietcraft-custom-apparel-studio',
            logo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
            banner: 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&q=80&w=600',
            description: 'Thời trang in ấn công nghệ DTG cao cấp, vải 100% Cotton 2 chiều & 4 chiều',
            average_rating: 4.9,
            listing_count: 2,
        });

        const shippingProfileId = new mongoose.Types.ObjectId();

        // 2. Create Products & Variants

        // P1: Áo thun Unisex Cotton 100% 250gsm
        const p1 = await Product.create({
            shop_id: shop1._id,
            shipping_profile_id: shippingProfileId,
            title: 'Áo thun Unisex Heavyweight Cotton 250gsm',
            description: 'Phôi áo thun trơn chất liệu 100% Cotton chải kỹ 250gsm, đứng form chuẩn streetwear, không xù lông và thấm hút mồ hôi cực tốt. Bề mặt vải mịn phẳng tối ưu cho công nghệ in ấn kỹ thuật số DTG và in lụa cao cấp.',
            product_type: 'POD_TEMPLATE',
            allow_customization: true,
            images: [
                'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=600&q=80',
                'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&w=800&q=80'
            ],
            categories: ['Áo thun (T-Shirt)'],
            tags: ['TP.HCM', 'cotton', 'unisex', 'oversize'],
            weight_g: 250,
            dimensions_cm: { length: 30, width: 25, height: 2 },
            stock_alert_threshold: 1,
            moderation_status: 'APPROVED',
            listing_status: 'ACTIVE',
            rejection_reason: '220000',
        });

        await ProductVariant.create([
            {
                product_id: p1._id,
                sku: 'BLANK-TSHIRT-BLK',
                color: 'Đen (Black)',
                mockup_image: '#1C1C1C',
                base_cost: mongoose.Types.Decimal128.fromString('110000'),
                retail_price: mongoose.Types.Decimal128.fromString('165000'),
                stock_quantity: 60,
                is_active: true
            },
            {
                product_id: p1._id,
                sku: 'BLANK-TSHIRT-WHT',
                color: 'Trắng (White)',
                mockup_image: '#FFFFFF',
                base_cost: mongoose.Types.Decimal128.fromString('110000'),
                retail_price: mongoose.Types.Decimal128.fromString('165000'),
                stock_quantity: 40,
                is_active: true
            }
        ]);

        // P2: Áo Hoodie Nỉ Bông Unisex
        const p2 = await Product.create({
            shop_id: shop1._id,
            shipping_profile_id: shippingProfileId,
            title: 'Áo Hoodie Nỉ Bông Chân Cua Form Rộng',
            description: 'Áo hoodie nỉ bông chân cua định lượng 380gsm dày dặn, mũ 2 lớp đứng form, bo dệt co giãn cao cấp. Thích hợp in ấn họa tiết mặt lưng hoặc ngực trước.',
            product_type: 'POD_TEMPLATE',
            allow_customization: true,
            images: [
                'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=600&q=80'
            ],
            categories: ['Áo Hoodie & Nỉ'],
            tags: ['Hà Nội', 'hoodie', 'nỉ bông'],
            weight_g: 650,
            dimensions_cm: { length: 35, width: 30, height: 5 },
            stock_alert_threshold: 2,
            moderation_status: 'APPROVED',
            listing_status: 'ACTIVE',
            rejection_reason: '380000',
        });

        await ProductVariant.create([
            {
                product_id: p2._id,
                sku: 'BLANK-HOODIE-GRY',
                color: 'Xám tiêu (Grey Melange)',
                mockup_image: '#6B7280',
                base_cost: mongoose.Types.Decimal128.fromString('210000'),
                retail_price: mongoose.Types.Decimal128.fromString('295000'),
                stock_quantity: 45,
                is_active: true
            },
            {
                product_id: p2._id,
                sku: 'BLANK-HOODIE-BLK',
                color: 'Đen tuyền',
                mockup_image: '#1C1C1C',
                base_cost: mongoose.Types.Decimal128.fromString('210000'),
                retail_price: mongoose.Types.Decimal128.fromString('295000'),
                stock_quantity: 35,
                is_active: true
            }
        ]);

        // P3: Túi Tote Vải Canvas Mộc Eco
        const p3 = await Product.create({
            shop_id: shop2._id,
            shipping_profile_id: shippingProfileId,
            title: 'Túi Tote Vải Canvas Mộc Khóa Kéo',
            description: 'Túi tote vải bố canvas mộc tự nhiên 12oz, có khóa kéo miệng và ngăn phụ bên trong. Diện tích in lớn 30x30cm thể hiện trọn vẹn tác phẩm thiết kế đồ họa.',
            product_type: 'POD_TEMPLATE',
            allow_customization: true,
            images: [
                'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=600&q=80'
            ],
            categories: ['Túi Tote & Canvas'],
            tags: ['TP.HCM', 'canvas', 'eco'],
            weight_g: 180,
            dimensions_cm: { length: 38, width: 35, height: 1 },
            stock_alert_threshold: 3,
            moderation_status: 'APPROVED',
            listing_status: 'ACTIVE',
            rejection_reason: '110000',
        });

        await ProductVariant.create([
            {
                product_id: p3._id,
                sku: 'BLANK-TOTE-NAT',
                color: 'Canvas Mộc Tự Nhiên',
                mockup_image: '#E6D7B9',
                base_cost: mongoose.Types.Decimal128.fromString('45000'),
                retail_price: mongoose.Types.Decimal128.fromString('79000'),
                stock_quantity: 80,
                is_active: true
            }
        ]);

        logger.info('POD apparel products seeded successfully.');
    } catch (err: any) {
        logger.error(`Error seeding database: ${err?.message || err}`);
    }
}
