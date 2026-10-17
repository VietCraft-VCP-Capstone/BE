import mongoose from 'mongoose';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { User } from '../../user/infrastructure/models/user.model';
import {
    SellerSettingsResponseDTO,
    SellerBrandSettingsDTO,
    SellerShippingSettingsDTO,
    SellerPaymentSettingsDTO,
    SellerNotificationSettingsDTO
} from './seller-settings.dto';
import { logger } from '../../../shared/utils/logger';
import { generateSlug } from '../../../shared/utils/slug';
import { isCloudinaryEnabled, uploadImage } from '../../../infrastructure/storage/cloudinary.service';
import { encryptField, decryptField, maskBankAccount, isEncryptedField } from '../../../shared/utils/crypto.service';

const DEFAULT_SETTINGS: SellerSettingsResponseDTO = {
    brand: {
        storeName: '',
        slug: '',
        headline: '',
        description: '',
        hotline: '',
        email: '',
        workshopAddress: '',
        bannerUrl: '',
        logoUrl: '',
        establishedYear: new Date().getFullYear().toString(),
        craftVillage: '',
        printTechnology: '',
        mainCategory: ''
    },
    shipping: {
        senderName: '',
        senderPhone: '',
        province: '',
        district: '',
        ward: '',
        specificAddress: '',
        carriers: [
            {
                id: 'ghn',
                name: 'Giao Hàng Nhanh (GHN)',
                enabled: true,
                estimatedTime: '1 - 2 ngày'
            },
            {
                id: 'ghtk',
                name: 'Giao Hàng Tiết Kiệm (GHTK)',
                enabled: true,
                estimatedTime: '2 - 3 ngày'
            }
        ],
        useFlatRate: false,
        flatRateFee: 0
    },
    payment: {
        bankAccounts: [],
        autoWithdraw: false,
        payoutCycle: 'WEEKLY_MON',
        minPayoutAmount: 500
    },
    notifications: {
        orders: {
            newOrder: { email: true, app: true },
            returnRefund: { email: true, app: true },
            cancelled: { email: true, app: false }
        },
        inventory: {
            lowStock: { email: true, app: true },
            listingApproval: { email: true, app: true }
        },
        analytics: {
            weeklyReport: { email: true, app: false },
            promotions: { email: false, app: true }
        }
    },
    updatedAt: new Date().toISOString()
};

export async function resolveUniqueSlug(desired: string, ownerId: mongoose.Types.ObjectId, seed: string): Promise<string> {
    let base = generateSlug(desired || '');
    if (!base || base === 'untitled') base = `shop-${seed}`;

    let candidate = base;
    for (let i = 1; i <= 50; i++) {
        const clash = await Shop.findOne({ slug: candidate, owner_id: { $ne: ownerId } }).select('_id');
        if (!clash) return candidate;
        candidate = `${base}-${i}`;
    }
    return `${base}-${Date.now()}`;
}

export class SellerSettingsService {
    static async getSettings(sellerId: string): Promise<SellerSettingsResponseDTO> {
        if (!mongoose.Types.ObjectId.isValid(sellerId)) {
            throw new Error('ID người bán không hợp lệ.');
        }

        const ownerId = new mongoose.Types.ObjectId(sellerId);
        let shop = await Shop.findOne({ owner_id: ownerId });
        const user = await User.findById(ownerId);

        if (!shop) {
            shop = await Shop.create({
                owner_id: ownerId,
                shop_name: user?.full_name ? `${user.full_name}'s Shop` : DEFAULT_SETTINGS.brand.storeName,
                slug: await resolveUniqueSlug('', ownerId, sellerId.substring(18)),
                description: DEFAULT_SETTINGS.brand.description,
                logo: user?.avatar || DEFAULT_SETTINGS.brand.logoUrl,
                banner: DEFAULT_SETTINGS.brand.bannerUrl,
                settings: DEFAULT_SETTINGS,
                listing_count: 0,
                average_rating: 5.0
            });
        }

        const customSettings = shop.settings || {};

        const brand: SellerBrandSettingsDTO = {
            ...DEFAULT_SETTINGS.brand,
            ...(customSettings.brand || {}),
            storeName: shop.shop_name || customSettings.brand?.storeName || DEFAULT_SETTINGS.brand.storeName,
            slug: shop.slug || customSettings.brand?.slug || DEFAULT_SETTINGS.brand.slug,
            description: shop.description || customSettings.brand?.description || DEFAULT_SETTINGS.brand.description,
            logoUrl: shop.logo || customSettings.brand?.logoUrl || DEFAULT_SETTINGS.brand.logoUrl,
            bannerUrl: shop.banner || customSettings.brand?.bannerUrl || DEFAULT_SETTINGS.brand.bannerUrl,
            email: user?.email || customSettings.brand?.email || DEFAULT_SETTINGS.brand.email,
        };

        const shipping: SellerShippingSettingsDTO = {
            ...DEFAULT_SETTINGS.shipping,
            ...(customSettings.shipping || {}),
            carriers: (customSettings.shipping?.carriers || DEFAULT_SETTINGS.shipping.carriers).filter(
                (c: any) => c && c.id !== 'viettelpost' && c.id !== 'vtp' && !c.name?.toLowerCase().includes('viettel')
            )
        };

        // Tự động mã hóa lại dữ liệu cũ nếu trong DB đang lưu số tài khoản dạng plaintext
        let needMigration = false;
        if (shop.bank_info?.account_number && !isEncryptedField(shop.bank_info.account_number)) {
            shop.bank_info.account_number = encryptField(shop.bank_info.account_number);
            needMigration = true;
        }
        if (customSettings.payment?.bankAccounts) {
            for (const b of customSettings.payment.bankAccounts) {
                if (b.accountNumber && !isEncryptedField(b.accountNumber)) {
                    b.accountNumber = encryptField(b.accountNumber);
                    needMigration = true;
                }
            }
        }
        if (needMigration) {
            shop.markModified('bank_info');
            shop.markModified('settings');
            await shop.save();
        }

        const payment: SellerPaymentSettingsDTO = {
            ...DEFAULT_SETTINGS.payment,
            ...(customSettings.payment || {})
        };

        // Fallback: If bankAccounts is empty but shop.bank_info exists, migrate it
        if ((!payment.bankAccounts || payment.bankAccounts.length === 0) && shop.bank_info?.account_number) {
            const rawNumber = decryptField(shop.bank_info.account_number);
            payment.bankAccounts = [{
                id: 'bank_default_0',
                bankName: shop.bank_info.bank_code || 'Ngân hàng thụ hưởng',
                bankCode: shop.bank_info.bank_code || 'BANK',
                accountNumber: maskBankAccount(rawNumber),
                accountHolder: shop.bank_info.account_holder,
                branch: 'Chi nhánh mặc định',
                isDefault: true
            }];
        } else if (payment.bankAccounts && payment.bankAccounts.length > 0) {
            // Luôn che mờ (mask) số tài khoản trước khi trả về Frontend DTO
            payment.bankAccounts = payment.bankAccounts.map((b: any) => ({
                ...b,
                accountNumber: maskBankAccount(decryptField(b.accountNumber))
            }));
        }

        const notifications: SellerNotificationSettingsDTO = {
            ...DEFAULT_SETTINGS.notifications,
            ...(customSettings.notifications || {})
        };

        return {
            brand,
            shipping,
            payment,
            notifications,
            updatedAt: shop.updated_at ? new Date(shop.updated_at).toISOString() : new Date().toISOString()
        };
    }

    static async updateSettings(sellerId: string, payload: Partial<SellerSettingsResponseDTO>): Promise<SellerSettingsResponseDTO> {
        if (!mongoose.Types.ObjectId.isValid(sellerId)) {
            throw new Error('ID người bán không hợp lệ.');
        }

        const ownerId = new mongoose.Types.ObjectId(sellerId);
        let shop = await Shop.findOne({ owner_id: ownerId });

        if (!shop) {
            shop = await Shop.create({
                owner_id: ownerId,
                shop_name: payload.brand?.storeName || 'My Shop',
                slug: await resolveUniqueSlug(payload.brand?.slug || '', ownerId, sellerId.substring(18)),
                settings: {}
            });
        }

        const currentSettings = shop.settings || {};

        if (payload.brand) {
            if (payload.brand.logoUrl && payload.brand.logoUrl.startsWith('data:image/') && isCloudinaryEnabled()) {
                try {
                    const asset = await uploadImage(payload.brand.logoUrl, { folder: 'shops' });
                    payload.brand.logoUrl = asset.url;
                } catch (e: any) {
                    logger.warn('Failed to upload base64 logo to Cloudinary: ' + e.message);
                }
            }

            if (payload.brand.bannerUrl && payload.brand.bannerUrl.startsWith('data:image/') && isCloudinaryEnabled()) {
                try {
                    const asset = await uploadImage(payload.brand.bannerUrl, { folder: 'shops' });
                    payload.brand.bannerUrl = asset.url;
                } catch (e: any) {
                    logger.warn('Failed to upload base64 banner to Cloudinary: ' + e.message);
                }
            }

            currentSettings.brand = {
                ...(currentSettings.brand || {}),
                ...payload.brand
            };
            if (payload.brand.storeName) shop.shop_name = payload.brand.storeName;
            if (payload.brand.slug) {
                shop.slug = await resolveUniqueSlug(payload.brand.slug, ownerId, sellerId.substring(18));
            }
            if (payload.brand.description) shop.description = payload.brand.description;
            if (payload.brand.logoUrl) shop.logo = payload.brand.logoUrl;
            if (payload.brand.bannerUrl) shop.banner = payload.brand.bannerUrl;
        }

        if (payload.shipping) {
            const cleanCarriers = (payload.shipping.carriers || []).filter(
                (c: any) => c && c.id !== 'viettelpost' && c.id !== 'vtp' && !c.name?.toLowerCase().includes('viettel')
            );
            currentSettings.shipping = {
                ...(currentSettings.shipping || {}),
                ...payload.shipping,
                carriers: cleanCarriers
            };
        }

        if (payload.payment) {
            const minPayout = Number(payload.payment.minPayoutAmount);
            if (payload.payment.autoWithdraw && !isNaN(minPayout) && minPayout > 0 && minPayout < 500) {
                throw new Error('Hạn mức rút tiền tối thiểu phải từ 500 VNĐ trở lên.');
            }

            const validMinPayout = !isNaN(minPayout) && minPayout >= 500 ? minPayout : 500;
            const existingAccounts = currentSettings.payment?.bankAccounts || [];

            const sanitizedAccounts = (payload.payment.bankAccounts || []).map((acc: any) => {
                const existing = existingAccounts.find((e: any) => e.id === acc.id);
                let accNum = String(acc.accountNumber || '').trim();

                // Nếu số gửi lên chứa dấu * (đã được mask), giữ nguyên chuỗi đã mã hóa trong DB
                if (accNum.includes('*') && existing?.accountNumber) {
                    accNum = existing.accountNumber;
                } else if (accNum && !isEncryptedField(accNum)) {
                    // Số tài khoản mới nhập thô -> Mã hóa bằng AES-256-CBC
                    accNum = encryptField(accNum);
                }

                return {
                    ...acc,
                    accountNumber: accNum
                };
            });

            currentSettings.payment = {
                ...(currentSettings.payment || {}),
                ...payload.payment,
                bankAccounts: sanitizedAccounts,
                minPayoutAmount: validMinPayout
            };
            const defaultBank = sanitizedAccounts.find((b: any) => b.isDefault) || sanitizedAccounts[0];
            if (defaultBank) {
                shop.bank_info = {
                    bank_code: defaultBank.bankCode,
                    account_number: defaultBank.accountNumber,
                    account_holder: defaultBank.accountHolder
                };
                shop.markModified('bank_info');
            }
        }

        if (payload.notifications) {
            currentSettings.notifications = {
                ...(currentSettings.notifications || {}),
                ...payload.notifications
            };
        }

        shop.settings = currentSettings;
        shop.markModified('settings');
        await shop.save();

        logger.info(`Updated seller settings for shop: ${shop._id} (Owner: ${sellerId})`);
        return this.getSettings(sellerId);
    }

    /**
     * Lấy danh sách tài khoản ngân hàng đã giải mã (chỉ dùng nội bộ Backend cho đối soát/rút tiền)
     */
    static async getDecryptedBankAccounts(sellerId: string): Promise<any[]> {
        if (!mongoose.Types.ObjectId.isValid(sellerId)) return [];
        const ownerId = new mongoose.Types.ObjectId(sellerId);
        const shop = await Shop.findOne({ owner_id: ownerId });
        if (!shop) return [];
        const accounts = shop.settings?.payment?.bankAccounts || [];
        return accounts.map((b: any) => ({
            ...b,
            accountNumber: decryptField(b.accountNumber || '')
        }));
    }
}

