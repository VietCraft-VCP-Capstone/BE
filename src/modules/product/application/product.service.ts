import mongoose from 'mongoose';
import { Product as MongoProduct } from '../infrastructure/models/product.model';
import { ProductVariant as MongoVariant } from '../infrastructure/models/product-variant.model';
import { Shop } from '../infrastructure/models/shop.model';
import {
    ProductItemResponseDTO,
    ProductFormDataDTO,
    ProductStatus,
    ProductColorVariantDTO,
    InventoryTrendPointDTO,
    ProductFilterQueryDTO,
    PaginatedProductsResponseDTO
} from './product.dto';
import { logger } from '../../../shared/utils/logger';

function getColorHex(colorName: string): string {
    const lower = (colorName || '').toLowerCase();
    if (lower.includes('nâu') || lower.includes('brown')) return '#5C4033';
    if (lower.includes('gỗ') || lower.includes('sồi') || lower.includes('oak')) return '#C29B38';
    if (lower.includes('đen') || lower.includes('black')) return '#1C1C1C';
    if (lower.includes('xanh lá') || lower.includes('green')) return '#22C55E';
    if (lower.includes('xanh lục')) return '#15803D';
    if (lower.includes('lam') || lower.includes('xanh dương') || lower.includes('blue')) return '#1D4ED8';
    if (lower.includes('trắng') || lower.includes('white') || lower.includes('ngà')) return '#F9FAFB';
    if (lower.includes('đỏ') || lower.includes('red')) return '#DC2626';
    if (lower.includes('vàng') || lower.includes('yellow')) return '#EAB308';
    if (lower.includes('xám') || lower.includes('gray')) return '#9CA3AF';
    return '#8B5CF6';
}

function mapToProductItemResponse(product: any, variants: any[], shop?: any): ProductItemResponseDTO {
    const mainVariant = variants[0];
    const price = mainVariant ? parseFloat(mainVariant.retail_price?.toString() || '0') : 0;
    const totalStock = variants.reduce((sum, v) => sum + (Number(v.stock_quantity) || 0), 0);
    const stockValue = price * totalStock;
    const sku = mainVariant?.sku || `VC-PRD-${product._id.toString().substring(18).toUpperCase()}`;

    const colors: ProductColorVariantDTO[] = variants
        .filter(v => Boolean(v.color))
        .map(v => {
            const hex = (v.mockup_image && v.mockup_image.startsWith('#')) ? v.mockup_image : getColorHex(v.color);
            return {
                name: v.color,
                hex: hex
            };
        });

    const status: ProductStatus = product.listing_status === 'INACTIVE'
        ? 'INACTIVE'
        : (totalStock > 0 ? 'ACTIVE' : 'OUT_OF_STOCK');

    const images = Array.isArray(product.images) && product.images.length > 0
        ? product.images
        : ['https://images.unsplash.com/photo-1592078615290-033ee584e267?auto=format&fit=crop&w=600&q=80'];

    const thumbnail = images[0];

    const originalPrice = product.rejection_reason && !isNaN(Number(product.rejection_reason))
        ? Number(product.rejection_reason)
        : (price ? Math.round(price * 1.1) : 0);

    const baseRank = product.stock_alert_threshold || 1;
    const engagementTrend = [
        Math.max(15, (baseRank * 12 + 10) % 90 + 20),
        Math.max(20, (baseRank * 15 + 15) % 100 + 25),
        Math.max(30, (baseRank * 22 + 20) % 110 + 35),
        Math.max(45, (baseRank * 28 + 25) % 120 + 45),
        Math.max(55, (baseRank * 35 + 30) % 130 + 55),
        Math.max(70, (baseRank * 40 + 35) % 140 + 70),
        Math.max(85, (baseRank * 45 + 40) % 150 + 85),
    ];

    const inventoryTrends: InventoryTrendPointDTO[] = [
        { date: 'Jan 21', stock: Math.round(totalStock * 1.6) },
        { date: 'Mar 3', stock: Math.round(totalStock * 1.4) },
        { date: 'Jul 9', stock: Math.round(totalStock * 1.2) },
        { date: 'Oct 25', stock: Math.round(totalStock * 1.1) },
        { date: 'Jan 20', stock: totalStock }
    ];

    const location = (product.tags && product.tags[0]) || '';

    return {
        id: product._id.toString(),
        sku,
        title: product.title,
        category: product.categories?.[0] || '',
        price,
        originalPrice,
        stock: totalStock,
        stockValue,
        status,
        location,
        rank: baseRank,
        description: product.description || '',
        thumbnail,
        images,
        colors: colors.length > 0 ? colors : [{ name: 'Tự nhiên', hex: '#5C4033' }],
        engagementTrend,
        inventoryTrends,
        createdAt: product.created_at ? new Date(product.created_at).toISOString() : new Date().toISOString(),
        updatedAt: product.updated_at ? new Date(product.updated_at).toISOString() : new Date().toISOString(),
    };
}

export class ProductsService {
    static async getAll(filter?: ProductFilterQueryDTO): Promise<PaginatedProductsResponseDTO> {
        const query: any = {};

        // Seller-specific product isolation
        if (filter?.sellerId && mongoose.Types.ObjectId.isValid(filter.sellerId)) {
            const sellerShop = await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(filter.sellerId) });
            if (!sellerShop) {
                return { items: [], total: 0, page: 1, limit: filter?.limit || 6, totalPages: 0 };
            }
            query.shop_id = sellerShop._id;
        } else if (filter?.shopId && mongoose.Types.ObjectId.isValid(filter.shopId)) {
            query.shop_id = new mongoose.Types.ObjectId(filter.shopId);
        }

        if (filter?.status && filter.status !== 'ALL') {
            const queryStatus = filter.status === 'OUT_OF_STOCK' ? 'ACTIVE' : filter.status;
            query.listing_status = queryStatus;
        }

        if (filter?.category && filter.category.trim() !== '' && filter.category !== 'Tất cả danh mục' && filter.category !== 'ALL') {
            query.categories = { $in: [new RegExp(filter.category.trim(), 'i')] };
        }

        if (filter?.search && filter.search.trim() !== '') {
            const s = filter.search.trim();
            query.$or = [
                { title: { $regex: s, $options: 'i' } },
                { description: { $regex: s, $options: 'i' } },
                { tags: { $in: [new RegExp(s, 'i')] } }
            ];
        }

        let sortOption: any = { created_at: -1 };
        if (filter?.sort === 'price_asc') {
            sortOption = { created_at: -1 };
        } else if (filter?.sort === 'price_desc') {
            sortOption = { created_at: -1 };
        } else if (filter?.sort === 'newest') {
            sortOption = { created_at: -1 };
        }

        const total = await MongoProduct.countDocuments(query);
        const page = Math.max(1, Number(filter?.page) || 1);
        const limit = Math.max(1, Number(filter?.limit || filter?.pageSize) || 6);
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const skip = (page - 1) * limit;

        const mongoProducts = await MongoProduct.find(query)
            .sort(sortOption)
            .skip(skip)
            .limit(limit);

        const productIds = mongoProducts.map(p => p._id);
        const shopIds = [...new Set(mongoProducts.map(p => p.shop_id).filter(Boolean))];

        const [allVariants, allShops] = await Promise.all([
            MongoVariant.find({ product_id: { $in: productIds } }),
            Shop.find({ _id: { $in: shopIds } })
        ]);

        const variantsByProductId = new Map<string, any[]>();
        for (const v of allVariants) {
            const pid = v.product_id.toString();
            if (!variantsByProductId.has(pid)) {
                variantsByProductId.set(pid, []);
            }
            variantsByProductId.get(pid)!.push(v);
        }

        const shopsById = new Map<string, any>();
        for (const s of allShops) {
            shopsById.set(s._id.toString(), s);
        }

        const items: ProductItemResponseDTO[] = mongoProducts.map(mp => {
            const variants = variantsByProductId.get(mp._id.toString()) || [];
            const shop = shopsById.get(mp.shop_id?.toString());
            return mapToProductItemResponse(mp, variants, shop);
        });

        return {
            items,
            total,
            page,
            limit,
            totalPages,
        };
    }

    static async getById(id: string): Promise<ProductItemResponseDTO> {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new Error('Mã sản phẩm không hợp lệ.');
        }

        const mp = await MongoProduct.findById(id);
        if (!mp) {
            throw new Error('Không tìm thấy sản phẩm.');
        }

        const variants = await MongoVariant.find({ product_id: mp._id });
        const shop = await Shop.findById(mp.shop_id);
        return mapToProductItemResponse(mp, variants, shop);
    }

    static async create(sellerId: string, payload: ProductFormDataDTO): Promise<ProductItemResponseDTO> {
        let validOwnerId: mongoose.Types.ObjectId;
        if (mongoose.Types.ObjectId.isValid(sellerId)) {
            validOwnerId = new mongoose.Types.ObjectId(sellerId);
        } else {
            validOwnerId = new mongoose.Types.ObjectId();
        }

        let shop = await Shop.findOne({ owner_id: validOwnerId });
        if (!shop) {
            shop = await Shop.create({
                owner_id: validOwnerId,
                shop_name: 'Shop',
                slug: `shop-${validOwnerId.toString().substring(18)}`,
                description: payload.location || '',
                average_rating: 5.0,
                listing_count: 1,
            });
        }

        const shippingProfileId = new mongoose.Types.ObjectId();
        const images = payload.images && payload.images.length > 0
            ? payload.images
            : (payload.thumbnail ? [payload.thumbnail] : []);

        const mp = await MongoProduct.create({
            shop_id: shop._id,
            shipping_profile_id: shippingProfileId,
            title: payload.title,
            description: payload.description || payload.title || '',
            product_type: 'READY_TO_SHIP',
            allow_customization: false,
            images: images.length > 0 ? images : ['https://images.unsplash.com/photo-1592078615290-033ee584e267?auto=format&fit=crop&w=600&q=80'],
            categories: payload.category ? [payload.category] : [],
            tags: payload.location ? [payload.location] : [],
            weight_g: 500,
            dimensions_cm: { length: 10, width: 10, height: 10 },
            stock_alert_threshold: payload.rank || 1,
            moderation_status: 'APPROVED',
            listing_status: payload.status === 'OUT_OF_STOCK' ? 'ACTIVE' : (payload.status || 'ACTIVE'),
            rejection_reason: payload.originalPrice ? payload.originalPrice.toString() : undefined,
        });

        const createdVariants: any[] = [];
        const basePrice = Number(payload.price) || 0;
        const totalStock = Number(payload.stock) || 0;
        const baseSku = payload.sku || `VC-PRD-${mp._id.toString().substring(18).toUpperCase()}`;

        if (payload.colors && payload.colors.length > 0) {
            const stockPerColor = Math.max(1, Math.floor(totalStock / payload.colors.length));
            for (let i = 0; i < payload.colors.length; i++) {
                const c = payload.colors[i];
                const v = await MongoVariant.create({
                    product_id: mp._id,
                    sku: `${baseSku}-${i + 1}`,
                    color: c.name,
                    mockup_image: c.hex,
                    base_cost: mongoose.Types.Decimal128.fromString((basePrice * 0.7).toFixed(0)),
                    retail_price: mongoose.Types.Decimal128.fromString(basePrice.toString()),
                    stock_quantity: i === payload.colors.length - 1 ? totalStock - (stockPerColor * (payload.colors.length - 1)) : stockPerColor,
                    is_active: true,
                });
                createdVariants.push(v);
            }
        } else {
            const v = await MongoVariant.create({
                product_id: mp._id,
                sku: baseSku,
                color: 'Tự nhiên',
                mockup_image: '#5C4033',
                base_cost: mongoose.Types.Decimal128.fromString((basePrice * 0.7).toFixed(0)),
                retail_price: mongoose.Types.Decimal128.fromString(basePrice.toString()),
                stock_quantity: totalStock,
                is_active: true,
            });
            createdVariants.push(v);
        }

        logger.info(`Created new product: ${mp._id} (${mp.title})`);
        return mapToProductItemResponse(mp, createdVariants, shop);
    }

    static async update(id: string, sellerId: string, payload: Partial<ProductFormDataDTO>): Promise<ProductItemResponseDTO> {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new Error('Mã sản phẩm không hợp lệ.');
        }

        const mp = await MongoProduct.findById(id);
        if (!mp) {
            throw new Error('Không tìm thấy sản phẩm cần cập nhật.');
        }

        if (payload.title !== undefined) mp.title = payload.title;
        if (payload.description !== undefined) mp.description = payload.description;
        if (payload.category !== undefined) mp.categories = [payload.category];
        if (payload.location !== undefined) mp.tags = [payload.location];
        if (payload.rank !== undefined) mp.stock_alert_threshold = payload.rank;
        if (payload.status !== undefined) mp.listing_status = payload.status === 'OUT_OF_STOCK' ? 'ACTIVE' : payload.status;
        if (payload.originalPrice !== undefined) mp.rejection_reason = payload.originalPrice.toString();
        if (payload.images && payload.images.length > 0) {
            mp.images = payload.images;
        } else if (payload.thumbnail) {
            mp.images = [payload.thumbnail];
        }

        await mp.save();

        if (payload.colors && payload.colors.length > 0) {
            await MongoVariant.deleteMany({ product_id: mp._id });
            const totalStock = payload.stock !== undefined ? Number(payload.stock) : 50;
            const basePrice = payload.price !== undefined ? Number(payload.price) : 100000;
            const baseSku = payload.sku || `VC-PRD-${mp._id.toString().substring(18).toUpperCase()}`;
            const stockPerColor = Math.max(1, Math.floor(totalStock / payload.colors.length));

            for (let i = 0; i < payload.colors.length; i++) {
                const c = payload.colors[i];
                await MongoVariant.create({
                    product_id: mp._id,
                    sku: `${baseSku}-${i + 1}`,
                    color: c.name,
                    mockup_image: c.hex,
                    base_cost: mongoose.Types.Decimal128.fromString((basePrice * 0.7).toFixed(0)),
                    retail_price: mongoose.Types.Decimal128.fromString(basePrice.toString()),
                    stock_quantity: i === payload.colors.length - 1 ? totalStock - (stockPerColor * (payload.colors.length - 1)) : stockPerColor,
                    is_active: true,
                });
            }
        } else {
            const updates: any = {};
            if (payload.price !== undefined) {
                updates.retail_price = mongoose.Types.Decimal128.fromString(payload.price.toString());
                updates.base_cost = mongoose.Types.Decimal128.fromString((Number(payload.price) * 0.7).toFixed(0));
            }
            if (payload.stock !== undefined) {
                updates.stock_quantity = Number(payload.stock);
            }
            if (payload.sku !== undefined) {
                updates.sku = payload.sku;
            }

            if (Object.keys(updates).length > 0) {
                await MongoVariant.updateMany({ product_id: mp._id }, updates);
            }
        }

        const variants = await MongoVariant.find({ product_id: mp._id });
        const shop = await Shop.findById(mp.shop_id);
        logger.info(`Updated product: ${mp._id} (${mp.title})`);
        return mapToProductItemResponse(mp, variants, shop);
    }

    static async delete(id: string, sellerId: string): Promise<{ success: boolean; message: string }> {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new Error('Mã sản phẩm không hợp lệ.');
        }

        const mp = await MongoProduct.findById(id);
        if (!mp) {
            throw new Error('Không tìm thấy sản phẩm cần xóa.');
        }

        await MongoProduct.findByIdAndDelete(id);
        await MongoVariant.deleteMany({ product_id: mp._id });

        logger.info(`Permanently deleted product: ${id}`);
        return { success: true, message: `Đã xóa sản phẩm thành công.` };
    }

    static async batchDelete(ids: string[], sellerId: string): Promise<{ success: boolean; count: number }> {
        if (!Array.isArray(ids) || ids.length === 0) {
            return { success: true, count: 0 };
        }

        const validIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));
        if (validIds.length === 0) {
            return { success: true, count: 0 };
        }

        const result = await MongoProduct.deleteMany({ _id: { $in: validIds } });
        await MongoVariant.deleteMany({ product_id: { $in: validIds } });

        logger.info(`Permanently batch deleted ${result.deletedCount} products.`);
        return { success: true, count: result.deletedCount };
    }

    static async updateStatus(ids: string[], status: ProductStatus, sellerId: string): Promise<{ success: boolean; count: number }> {
        if (!Array.isArray(ids) || ids.length === 0) {
            return { success: true, count: 0 };
        }

        const validIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));
        const mongoStatus = status === 'OUT_OF_STOCK' ? 'ACTIVE' : status;
        const result = await MongoProduct.updateMany(
            { _id: { $in: validIds } },
            { $set: { listing_status: mongoStatus } }
        );

        logger.info(`Batch updated status to ${status} for ${result.modifiedCount} products.`);
        return { success: true, count: result.modifiedCount };
    }

    static async getFeaturedShops(): Promise<any[]> {
        return await Shop.find().limit(5);
    }
}
export default ProductsService;
