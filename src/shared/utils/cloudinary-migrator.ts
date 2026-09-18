import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import { config, initializeDatabases } from '../../app/config';
import { User } from '../../modules/user/infrastructure/models/user.model';
import { Shop } from '../../modules/product/infrastructure/models/shop.model';
import { Design } from '../../modules/design/infrastructure/models/design.model';
import { Product } from '../../modules/product/infrastructure/models/product.model';
import { ProductVariant } from '../../modules/product/infrastructure/models/product-variant.model';
import { isCloudinaryEnabled, uploadImage } from '../../infrastructure/storage/cloudinary.service';
import { UPLOAD_ROOT } from '../upload/upload.middleware';
import { logger } from './logger';

export async function migrateAllImagesToCloudinary(): Promise<{
    usersMigrated: number;
    shopsMigrated: number;
    designsMigrated: number;
    productsMigrated: number;
    variantsMigrated: number;
}> {
    if (!isCloudinaryEnabled()) {
        logger.warn('Cloudinary chưa được cấu hình, không thể thực hiện migration.');
        return { usersMigrated: 0, shopsMigrated: 0, designsMigrated: 0, productsMigrated: 0, variantsMigrated: 0 };
    }

    let usersMigrated = 0;
    let shopsMigrated = 0;
    let designsMigrated = 0;
    let productsMigrated = 0;
    let variantsMigrated = 0;

    // Cache để tái sử dụng ảnh đã upload (tránh upload trùng lặp các ảnh Unsplash giống nhau)
    const urlCache = new Map<string, string>();

    const uploadToCloudinary = async (sourceUrlOrPath: string, folder: string, isAvatar = false): Promise<string | null> => {
        if (!sourceUrlOrPath || sourceUrlOrPath.includes('cloudinary.com')) {
            return sourceUrlOrPath;
        }

        if (urlCache.has(sourceUrlOrPath)) {
            return urlCache.get(sourceUrlOrPath)!;
        }

        try {
            let actualSource = sourceUrlOrPath;

            // Nếu là đường dẫn cục bộ
            if (sourceUrlOrPath.startsWith('/uploads/')) {
                actualSource = path.join(UPLOAD_ROOT, sourceUrlOrPath.replace('/uploads/', ''));
                if (!fs.existsSync(actualSource)) {
                    logger.warn(`Tệp cục bộ không tồn tại: ${actualSource}`);
                    return null;
                }
            }

            const asset = await uploadImage(actualSource, {
                folder,
                transformation: isAvatar ? [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }] : undefined,
            });

            urlCache.set(sourceUrlOrPath, asset.url);
            return asset.url;
        } catch (err: any) {
            logger.error(`Lỗi khi tải ảnh lên Cloudinary (${sourceUrlOrPath.slice(0, 50)}...): ${err.message}`);
            return null;
        }
    };

    logger.info('=== BẮT ĐẦU QUÉT VÀ CHUYỂN TOÀN BỘ ẢNH TRONG HỆ THỐNG LÊN CLOUDINARY ===');

    // 1. Quét và chuyển đổi Avatar người dùng trong Users (Base64, Local, Unsplash, Google...)
    try {
        const users = await User.find({
            avatar: { $exists: true, $ne: '' }
        });

        for (const user of users) {
            if (user.avatar && !user.avatar.includes('cloudinary.com')) {
                logger.info(`Đang chuyển đổi avatar cho user: ${user.email}...`);
                const newUrl = await uploadToCloudinary(user.avatar, 'avatars', true);
                if (newUrl && newUrl !== user.avatar) {
                    user.avatar = newUrl;
                    await user.save();
                    usersMigrated++;
                    logger.info(`✓ Đã lưu avatar Cloudinary cho user ${user.email}: ${newUrl}`);
                }
            }
        }
    } catch (err: any) {
        logger.error('Lỗi khi quét bảng users: ' + err.message);
    }

    // 2. Quét và chuyển đổi Logo / Banner gian hàng trong Shops (kể cả ảnh Unsplash hay Base64)
    try {
        const shops = await Shop.find({});
        for (const shop of shops) {
            let updated = false;

            const logo = shop.logo || (shop.settings as any)?.brand?.logoUrl;
            if (logo && !logo.includes('cloudinary.com')) {
                logger.info(`Đang chuyển đổi logo cho shop: ${shop.shop_name}...`);
                const newLogo = await uploadToCloudinary(logo, 'shops');
                if (newLogo) {
                    shop.logo = newLogo;
                    if (shop.settings && (shop.settings as any).brand) {
                        (shop.settings as any).brand.logoUrl = newLogo;
                    }
                    updated = true;
                    logger.info(`✓ Đã lưu logo Cloudinary cho shop ${shop.shop_name}: ${newLogo}`);
                }
            }

            const banner = shop.banner || (shop.settings as any)?.brand?.bannerUrl;
            if (banner && !banner.includes('cloudinary.com')) {
                logger.info(`Đang chuyển đổi banner cho shop: ${shop.shop_name}...`);
                const newBanner = await uploadToCloudinary(banner, 'shops');
                if (newBanner) {
                    shop.banner = newBanner;
                    if (shop.settings && (shop.settings as any).brand) {
                        (shop.settings as any).brand.bannerUrl = newBanner;
                    }
                    updated = true;
                    logger.info(`✓ Đã lưu banner Cloudinary cho shop ${shop.shop_name}: ${newBanner}`);
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
        const designs = await Design.find({});
        for (const design of designs) {
            if (design.file_url && !design.file_url.includes('cloudinary.com')) {
                const newUrl = await uploadToCloudinary(design.file_url, 'designs');
                if (newUrl) {
                    design.file_url = newUrl;
                    design.storage = 'cloudinary';
                    await design.save();
                    designsMigrated++;
                    logger.info(`✓ Đã lưu thiết kế Cloudinary: ${design.name} -> ${newUrl}`);
                }
            }
        }
    } catch (err: any) {
        logger.error('Lỗi khi quét bảng designs: ' + err.message);
    }

    // 4. Quét và chuyển đổi TOÀN BỘ ảnh Sản phẩm trong Products (kể cả ảnh Unsplash seed)
    try {
        const products = await Product.find({});
        for (const product of products) {
            let changed = false;
            const newImages: string[] = [];

            for (const img of (product.images || [])) {
                if (img && !img.includes('cloudinary.com')) {
                    logger.info(`Đang chuyển ảnh sản phẩm "${product.title}": ${img.slice(0, 45)}...`);
                    const newUrl = await uploadToCloudinary(img, 'products');
                    if (newUrl) {
                        newImages.push(newUrl);
                        changed = true;
                        continue;
                    }
                }
                newImages.push(img);
            }

            if (changed) {
                product.images = newImages;
                await product.save();
                productsMigrated++;
                logger.info(`✓ Đã cập nhật toàn bộ ảnh Cloudinary cho sản phẩm: "${product.title}" (${newImages.length} ảnh)`);
            }
        }
    } catch (err: any) {
        logger.error('Lỗi khi quét bảng products: ' + err.message);
    }

    // 5. Quét và chuyển đổi mockup_image trong ProductVariant nếu là link ảnh
    try {
        const variants = await ProductVariant.find({
            mockup_image: { $exists: true, $ne: '' }
        });
        for (const variant of variants) {
            const mImg = variant.mockup_image;
            if (mImg && (mImg.startsWith('http') || mImg.startsWith('/uploads/')) && !mImg.includes('cloudinary.com')) {
                const newUrl = await uploadToCloudinary(mImg, 'mockups');
                if (newUrl) {
                    variant.mockup_image = newUrl;
                    await variant.save();
                    variantsMigrated++;
                }
            }
        }
    } catch (err: any) {
        logger.error('Lỗi khi quét bảng product_variants: ' + err.message);
    }

    logger.info('=== HOÀN TẤT DI CHUYỂN TOÀN BỘ ẢNH LÊN CLOUDINARY ===');
    logger.info(`- Users (Avatar): ${usersMigrated}`);
    logger.info(`- Shops (Logo/Banner): ${shopsMigrated}`);
    logger.info(`- Designs: ${designsMigrated}`);
    logger.info(`- Products: ${productsMigrated}`);
    logger.info(`- Product Variants: ${variantsMigrated}`);

    return { usersMigrated, shopsMigrated, designsMigrated, productsMigrated, variantsMigrated };
}

// Chạy trực tiếp: npx ts-node src/shared/utils/cloudinary-migrator.ts
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
