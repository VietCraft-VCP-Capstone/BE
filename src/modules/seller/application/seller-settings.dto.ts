export interface SellerBrandSettingsDTO {
    storeName: string;
    slug: string;
    headline?: string;
    description: string;
    hotline: string;
    email: string;
    workshopAddress: string;
    bannerUrl: string;
    logoUrl: string;
    establishedYear?: string;
    craftVillage?: string;
    printTechnology?: string;
    mainCategory?: string;
}

export interface ShippingCarrierItemDTO {
    id: 'ghn' | 'ghtk' | 'hỏa_tốc';
    name: string;
    logo?: string;
    enabled: boolean;
    estimatedTime?: string;
}

export type ShippingPricingType = 'FLAT_RATE' | 'ZONE_BASED';

export interface ZoneShippingRatesDTO {
    intraProvince: number; 
    intraRegion: number;   
    interRegion: number;  
}

export interface SellerShippingSettingsDTO {
    senderName: string;
    senderPhone: string;
    province: string;
    district: string;
    ward: string;
    specificAddress: string;
    carriers: ShippingCarrierItemDTO[];
    pricingType?: ShippingPricingType;
    useFlatRate: boolean;
    flatRateFee: number;
    zoneRates?: ZoneShippingRatesDTO;
}

export interface BankAccountItemDTO {
    id: string;
    bankName: string;
    bankCode: string;
    accountNumber: string;
    accountHolder: string;
    branch: string;
    isDefault: boolean;
}

export interface SellerPaymentSettingsDTO {
    bankAccounts: BankAccountItemDTO[];
    autoWithdraw: boolean;
    payoutCycle: 'DAILY' | 'WEEKLY_MON' | 'MONTHLY_01';
    minPayoutAmount: number;
}

export interface NotificationChannelSettingDTO {
    email: boolean;
    app: boolean;
}

export interface SellerNotificationSettingsDTO {
    orders: {
        newOrder: NotificationChannelSettingDTO;
        returnRefund: NotificationChannelSettingDTO;
        cancelled: NotificationChannelSettingDTO;
    };
    inventory: {
        lowStock: NotificationChannelSettingDTO;
        listingApproval: NotificationChannelSettingDTO;
    };
    analytics: {
        weeklyReport: NotificationChannelSettingDTO;
        promotions: NotificationChannelSettingDTO;
    };
}

export interface SellerSettingsResponseDTO {
    brand: SellerBrandSettingsDTO;
    shipping: SellerShippingSettingsDTO;
    payment: SellerPaymentSettingsDTO;
    notifications: SellerNotificationSettingsDTO;
    updatedAt: string;
}
