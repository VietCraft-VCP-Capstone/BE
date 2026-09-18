import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import { config, initializeDatabases } from '../../app/config';
import { User } from '../../modules/user/infrastructure/models/user.model';
import { Shop } from '../../modules/product/infrastructure/models/shop.model';
import { Design } from '../../modules/design/infrastructure/models/design.model';
import { Product } from '../../modules/product/infrastructure/models/product.model';
import { isCloudinaryEnabled, uploadImage } from '../../infrastructure/storage/cloudinary.service';
import { UPLOAD_ROOT } from '../upload/upload.middleware';
import { logger } from './logger';

export async function migrateAllImagesToCloudinary(): Promise<{
    usersMigrated: number;
    shopsMigrated: number;
    designsMigrated: number;
    productsMigrated: number;
}> {
    if (!isCloudinaryEnabled()) {
        logger.warn('Cloudinary chưa được cấu hình, không thể thực hiện migration.');
        return { usersMigrated: 0, shopsMigrated: 0, designsMigrated: 0, productsMigrated: 0 };
    }

    let usersMigrated = 0;
    let shopsMigrated = 0;
    let designsMigrated = 0;
    let productsMigrated = 0;

    logger.info('=== BẮT ĐẦU QUÉT VÀ DI CHUYỂN TOÀN BỘ ẢNH LÊN CLOUDINARY ===');

    // 1. Quét và chuyển đổi Avatar người dùng trong Users
    try {
        const users = await User.find({
            avatar: { $exists: true, $ne: '' }
        });

        for (const user of users) {
            const avatar = user.avatar;
            if (!avatar) continue;

            // Nếu là Base64 hoặc tệp local /uploads/
            if (avatar.startsWith('data:image/') || avatar.startsWith('/uploads/')) {
                try {
                    logger.info(`Đang chuyển đổi avatar cho user: ${user.email}...`);
                    let source: string = avatar;
                    if (avatar.startsWith('/uploads/')) {
                        source = path.join(UPLOAD_ROOT, avatar.replace('/uploads/', ''));
                        if (!fs.existsSync(source)) {
                            logger.warn(`File local không tồn tại: ${source}`);
                            continue;
                        }
                    }

                    const asset = await uploadImage(source, {
                        folder: 'avatars',
                        transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
                    });

                    user.avatar = asset.url;
                    await user.save();
                    usersMigrated++;
                    logger.info(`✓ Đã lưu avatar mới lên Cloudinary cho user ${user.email}: ${asset.url}`);
                } catch (err: any) {
                    logger.error(`Lỗi chuyển đổi avatar cho user ${user.email}: ${err.message}`);
                }
            }
        }
    } catch (err: any) {
        logger.error('Lỗi khi quét bảng users: ' + err.message);
    }

    // 2. Quét và chuyển đổi Logo / Banner gian hàng trong Shops
    try {
        const shops = await Shop.find({});
        for (const shop of shops) {
            let updated = false;

            // Kiểm tra Logo
            const logo = shop.logo || (shop.settings as any)?.brand?.logoUrl;
            if (logo && (logo.startsWith('data:image/') || logo.startsWith('/uploads/'))) {
                try {
                    let source = logo;
                    if (logo.startsWith('/uploads/')) {
                        source = path.join(UPLOAD_ROOT, logo.replace('/uploads/', ''));
                    }
                    if (!logo.startsWith('/uploads/') || fs.existsSync(source)) {
                        const asset = await uploadImage(source, { folder: 'shops' });
                        shop.logo = asset.url;
                        if (shop.settings && (shop.settings as any).brand) {
                            (shop.settings as any).brand.logoUrl = asset.url;
                        }
                        updated = true;
                        logger.info(`✓ Đã lưu logo mới cho shop ${shop.shop_name}: ${asset.url}`);
                    }
                } catch (err: any) {
                    logger.error(`Lỗi chuyển đổi logo cho shop ${shop.shop_name}: ${err.message}`);
                }
            }

            // Kiểm tra Banner
            const banner = shop.banner || (shop.settings as any)?.brand?.bannerUrl;
            if (banner && (banner.startsWith('data:image/') || banner.startsWith('/uploads/'))) {
                try {
                    let source = banner;
                    if (banner.startsWith('/uploads/')) {
                        source = path.join(UPLOAD_ROOT, banner.replace('/uploads/', ''));
                    }
                    if (!banner.startsWith('/uploads/') || fs.existsSync(source)) {
                        const asset = await uploadImage(source, { folder: 'shops' });
                        shop.banner = asset.url;
                        if (shop.settings && (shop.settings as any).brand) {
                            (shop.settings as any).brand.bannerUrl = asset.url;
                        }
                        updated = true;
                        logger.info(`✓ Đã lưu banner mới cho shop ${shop.shop_name}: ${asset.url}`);
                    }
                } catch (err: any) {
                    logger.error(`Lỗi chuyển đổi banner cho shop ${shop.shop_name}: ${err.message}`);
                }
            }

            if (updated) {
                await shop.save();
                shopsMigrated++;
            }
        }
    } catch (err: any) {
        logger.error('Lỗi khi quét bảng shops: ' + err.message);
    }

    // 3. Quét và chuyển đổi Thiết kế POD trong Designs
    try {
        const designs = await Design.find({ storage: 'local' });
        for (const design of designs) {
            if (design.file_url && design.file_url.startsWith('/uploads/')) {
                const absPath = path.join(UPLOAD_ROOT, design.file_url.replace('/uploads/', ''));
                if (fs.existsSync(absPath)) {
                    try {
                        const asset = await uploadImage(absPath, { folder: 'designs' });
                        design.file_url = asset.url;
                        design.public_id = asset.publicId;
                        design.storage = 'cloudinary';
                        await design.save();
                        designsMigrated++;
                        logger.info(`✓ Đã lưu thiết kế mới lên Cloudinary: ${design.name} -> ${asset.url}`);
                    } catch (err: any) {
                        logger.error(`Lỗi chuyển đổi thiết kế ${design.name}: ${err.message}`);
                    }
                }
            }
        }
    } catch (err: any) {
        logger.error('Lỗi khi quét bảng designs: ' + err.message);
    }

    // 4. Quét và chuyển đổi ảnh Sản phẩm trong Products
    try {
        const products = await Product.find({
            $or: [
                { images: { $elemMatch: { $regex: '^/uploads/' } } },
                { images: { $elemMatch: { $regex: '^data:image/' } } }
            ]
        });

        for (const product of products) {
            let changed = false;
            const newImages: string[] = [];

            for (const img of (product.images || [])) {
                if (img.startsWith('data:image/') || img.startsWith('/uploads/')) {
                    try {
                        let source = img;
                        if (img.startsWith('/uploads/')) {
                            source = path.join(UPLOAD_ROOT, img.replace('/uploads/', ''));
                        }
                        if (!img.startsWith('/uploads/') || fs.existsSync(source)) {
                            const asset = await uploadImage(source, { folder: 'products' });
                            newImages.push(asset.url);
                            changed = true;
                            continue;
                        }
                    } catch (err: any) {
                        logger.error(`Lỗi chuyển đổi ảnh sản phẩm ${product.title}: ${err.message}`);
                    }
                }
                newImages.push(img);
            }

            if (changed) {
                product.images = newImages;
                await product.save();
                productsMigrated++;
                logger.info(`✓ Đã cập nhật ảnh Cloudinary cho sản phẩm: ${product.title}`);
            }
        }
    } catch (err: any) {
        logger.error('Lỗi khi quét bảng products: ' + err.message);
    }

    logger.info('=== KẾT QUẢ DI CHUYỂN ẢNH LÊN CLOUDINARY ===');
    logger.info(`- Users (Avatar): ${usersMigrated}`);
    logger.info(`- Shops (Logo/Banner): ${shopsMigrated}`);
    logger.info(`- Designs: ${designsMigrated}`);
    logger.info(`- Products: ${productsMigrated}`);

    return { usersMigrated, shopsMigrated, designsMigrated, productsMigrated };
}

// Chạy trực tiếp từ dòng lệnh: ts-node src/shared/utils/cloudinary-migrator.ts
if (require.main === module) {
    (async () => {
        try {
            await initializeDatabases();
            const result = await migrateAllImagesToCloudinary();
            console.log('\nMIGRATION RESULT:', result);
            process.exit(0);
        } catch (err) {
            console.error('Migration failed:', err);
            process.exit(1);
        }
    })();
}
