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
        pricingType: 'FLAT_RATE',
        useFlatRate: true,
        flatRateFee: 0,
        zoneRates: {
            intraProvince: 22000,
            intraRegion: 30000,
            interRegion: 38000
        }
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

        const rawShipping = customSettings.shipping || {};
        const pricingType = rawShipping.pricingType || (rawShipping.useFlatRate !== false ? 'FLAT_RATE' : 'ZONE_BASED');

        const shipping: SellerShippingSettingsDTO = {
            ...DEFAULT_SETTINGS.shipping,
            ...rawShipping,
            pricingType,
            useFlatRate: pricingType === 'FLAT_RATE',
            flatRateFee: Number(rawShipping.flatRateFee ?? 0),
            zoneRates: {
                intraProvince: Number(rawShipping.zoneRates?.intraProvince ?? 22000),
                intraRegion: Number(rawShipping.zoneRates?.intraRegion ?? 30000),
                interRegion: Number(rawShipping.zoneRates?.interRegion ?? 38000),
            },
            carriers: (rawShipping.carriers || DEFAULT_SETTINGS.shipping.carriers).filter(
                (c: any) => c && c.id !== 'viettelpost' && c.id !== 'vtp' && !c.name?.toLowerCase().includes('viettel')
            )
        };

        const payment: SellerPaymentSettingsDTO = {
            ...DEFAULT_SETTINGS.payment,
            ...(customSettings.payment || {})
        };

        // Fallback: If bankAccounts is empty but shop.bank_info exists, migrate it
        if ((!payment.bankAccounts || payment.bankAccounts.length === 0) && shop.bank_info?.account_number) {
            payment.bankAccounts = [{
                id: 'bank_default_0',
                bankName: shop.bank_info.bank_code || 'Ngân hàng thụ hưởng',
                bankCode: shop.bank_info.bank_code || 'BANK',
                accountNumber: shop.bank_info.account_number,
                accountHolder: shop.bank_info.account_holder,
                branch: 'Chi nhánh mặc định',
                isDefault: true
            }];
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
            const pricingType = payload.shipping.pricingType || (payload.shipping.useFlatRate !== false ? 'FLAT_RATE' : 'ZONE_BASED');
            currentSettings.shipping = {
                ...(currentSettings.shipping || {}),
                ...payload.shipping,
                pricingType,
                useFlatRate: pricingType === 'FLAT_RATE',
                flatRateFee: Number(payload.shipping.flatRateFee ?? 0),
                zoneRates: {
                    intraProvince: Number(payload.shipping.zoneRates?.intraProvince ?? 22000),
                    intraRegion: Number(payload.shipping.zoneRates?.intraRegion ?? 30000),
                    interRegion: Number(payload.shipping.zoneRates?.interRegion ?? 38000),
                },
                carriers: cleanCarriers
            };
        }

        if (payload.payment) {
            const minPayout = Number(payload.payment.minPayoutAmount);
            if (payload.payment.autoWithdraw && !isNaN(minPayout) && minPayout > 0 && minPayout < 500) {
                throw new Error('Hạn mức rút tiền tối thiểu phải từ 500 VNĐ trở lên.');
            }

            const validMinPayout = !isNaN(minPayout) && minPayout >= 500 ? minPayout : 500;

            currentSettings.payment = {
                ...(currentSettings.payment || {}),
                ...payload.payment,
                minPayoutAmount: validMinPayout
            };
            const defaultBank = payload.payment.bankAccounts?.find(b => b.isDefault) || payload.payment.bankAccounts?.[0];
            if (defaultBank) {
                shop.bank_info = {
                    bank_code: defaultBank.bankCode,
                    account_number: defaultBank.accountNumber,
                    account_holder: defaultBank.accountHolder
                };
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
}

