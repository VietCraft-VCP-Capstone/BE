export type ProductStatus = 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK';

export interface ProductColorVariantDTO {
    name: string;
    hex: string;
}

export interface InventoryTrendPointDTO {
    date: string;
    stock: number;
}

export interface ProductVariantDTO {
    id: string;
    name: string;
    color?: string;
    size?: string;
    material?: string;
    price: number;
    stock: number;
    mockupImage?: string;
}

export interface ShopInfoDTO {
    id: string;
    name: string;
    logo?: string;
    rating: number;
}

export interface ProductItemResponseDTO {
    id: string;
    sku: string;
    title: string;
    category: string;
    price: number;
    originalPrice?: number;
    stock: number;
    stockValue: number;
    status: ProductStatus;
    location: string;
    rank: number;
    description: string;
    thumbnail: string;
    images: string[];
    colors: ProductColorVariantDTO[];
    engagementTrend: number[];
    inventoryTrends: InventoryTrendPointDTO[];
    variants?: ProductVariantDTO[];
    shopInfo?: ShopInfoDTO;
    sellerId?: string;
    tags?: string[];
    allowCustomization?: boolean;
    customizationType?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ProductFormDataDTO {
    title: string;
    category: string;
    categoryId?: string;
    tagIds?: string[];
    newTagNames?: string[];
    price: number;
    originalPrice?: number;
    stock?: number;
    sku?: string;
    location?: string;
    rank?: number;
    status?: ProductStatus;
    description?: string;
    thumbnail?: string;
    images?: string[];
    colors?: ProductColorVariantDTO[];
}

export interface ProductFilterQueryDTO {
    search?: string;
    category?: string;
    status?: string;
    sort?: string;
    page?: number;
    limit?: number;
    pageSize?: number;
    sellerId?: string;
    shopId?: string;
}

export interface PaginatedProductsResponseDTO {
    items: ProductItemResponseDTO[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}
