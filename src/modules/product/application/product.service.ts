import mongoose from 'mongoose';
import { Product as MongoProduct } from '../infrastructure/models/product.model';
import { ProductVariant as MongoVariant, syncProductDenorm } from '../infrastructure/models/product-variant.model';
import { Shop } from '../infrastructure/models/shop.model';
import { User } from '../../user/infrastructure/models/user.model';
import { Category } from '../../category';
import { categoryService } from '../../category/application/category.service';
import { Tag } from '../../tags';
import { tagsService } from '../../tags/application/tags.service';
import { Design } from '../../design/infrastructure/models/design.model';
import { generateSlug } from '../../../shared/utils/slug';
import { BlankClient, Blank } from './blank-client.service';
import { generateMockup, generateMockupLayers, generateWrapMockup, resolveColorHex } from './mockup.service';
import { normalizeRole } from '../../../app/middleware/auth.middleware';
import {
    ProductItemResponseDTO,
    ProductFormDataDTO,
    ProductStatus,
    ProductColorVariantDTO,
    InventoryTrendPointDTO,
    ProductFilterQueryDTO,
    PaginatedProductsResponseDTO,
    SearchProductsParams,
    SuggestResultDTO
} from './product.dto';
import { SearchLog } from '../../analytics/infrastructure/models/search-log.model';
import {
    normalizeVi,
    nfcLower,
    hasTone,
    escapeRegex,
    extractSearchTerms,
    buildPrefixes
} from '../../../shared/utils/vietnamese-search.util';
import { logger } from '../../../shared/utils/logger';
import { cacheService } from '../../../shared/services/cache.service';
import { CommissionSetting } from '../../../shared/services/commission-setting.service';
import { commissionFromGross, withCommission } from '../../../shared/utils/commission';
import { uploadImage, isCloudinaryEnabled } from '../../../infrastructure/storage/cloudinary.service';

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

    const legacyOriginal = product.rejection_reason && !isNaN(Number(product.rejection_reason))
        ? Number(product.rejection_reason)
        : undefined;
    const originalPrice = product.original_price
        ?? legacyOriginal
        ?? undefined;

    const baseRank = product.display_rank ?? product.stock_alert_threshold ?? 1;
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

    const location = product.location || (product.tags && product.tags[0]) || '';

    const mappedVariants = variants.map(v => ({
        id: v._id.toString(),
        name: [v.color, v.size, v.material].filter(Boolean).join(' - ') || 'Standard',
        color: v.color,
        size: v.size,
        material: v.material,
        price: parseFloat(v.retail_price?.toString() || '0'),
        stock: Number(v.stock_quantity) || 0,
        mockupImage: v.mockup_image,
    }));

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
        variants: mappedVariants,
        shopInfo: shop ? {
            id: shop._id.toString(),
            name: shop.shop_name,
            logo: shop.logo,
            rating: shop.average_rating ?? 5.0,
        } : undefined,
        sellerId: product.shop_id ? product.shop_id.toString() : undefined,
        tags: product.tags || [],
        rating: (typeof product.rating_count === 'number' && product.rating_count > 0)
            ? (typeof product.average_rating === 'number' ? product.average_rating : 0)
            : 0,
        ratingCount: typeof product.rating_count === 'number' ? product.rating_count : 0,
        allowCustomization: Boolean(product.allow_customization),
        customizationType: product.customization_type || 'NONE',
        productType: product.product_type || 'READY_TO_SHIP',
        soldCount: typeof product.sold_count === 'number' ? product.sold_count : 0,
        createdAt: product.created_at ? new Date(product.created_at).toISOString() : new Date().toISOString(),
        updatedAt: product.updated_at ? new Date(product.updated_at).toISOString() : new Date().toISOString(),
    };
}


export class ValidationError extends Error {
    errors: string[];
    constructor(errors: string[]) {
        super(errors.join('; '));
        this.name = 'ValidationError';
        this.errors = errors;
    }
}

export class ForbiddenError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ForbiddenError';
    }
}

interface VariantInput {
    color?: string;
    size?: string;
    material?: string;
    sku?: string;
    price?: number;
    base_cost?: number;
    stock?: number;
    mockup_image?: string;
}

interface ValidatedProductData {
    title: string;
    description: string;
    images: string[];
    category: { _id: mongoose.Types.ObjectId; name: string };
    tagDocs: { _id: mongoose.Types.ObjectId; name: string }[];
    newTagNames: string[];
    variants: VariantInput[];
    usesPrintify: boolean;
    isPod: boolean;
    blank?: Blank;
    podVariants?: { sku: string; markup: number; stock: number }[];
    designPlacements?: { design_id: string; print_area_key: string; x: number; y: number; scale: number; rotation: number }[];
}

export interface ProductActor {
    id: string;
    role: string;
}

const PUBLIC_QUERY = { status: 'PUBLISHED', is_hidden: { $ne: true } } as const;

export class ProductsService {

    static async validate(payload: any, opts: { partial?: boolean; sellerId?: string } = {}): Promise<ValidatedProductData> {
        const errors: string[] = [];
        const partial = opts.partial === true;

        const title = typeof payload.title === 'string' ? payload.title.trim() : '';
        if (!partial || payload.title !== undefined) {
            if (!title) errors.push('title is required');
        }

        const description = typeof payload.description === 'string' ? payload.description.trim() : '';
        if (!partial || payload.description !== undefined) {
            if (!description || description.length < 10) errors.push('description must be at least 10 characters');
        }

        let category: any = null;
        if (!partial || payload.categoryId !== undefined) {
            const categoryId = payload.categoryId;
            if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
                errors.push('categoryId is required and must be valid');
            } else {
                category = await Category.findById(categoryId).lean();
                if (!category) errors.push('category does not exist');
                else if (category.is_active === false) errors.push('category is not active');
            }
        }

        let tagDocs: any[] = [];
        if (payload.tagIds !== undefined) {
            const tagIds = Array.isArray(payload.tagIds) ? payload.tagIds : [];
            const invalid = tagIds.filter((t: any) => !mongoose.Types.ObjectId.isValid(t));
            if (invalid.length) errors.push(`invalid tag id(s): ${invalid.join(', ')}`);
            const validIds = tagIds.filter((t: any) => mongoose.Types.ObjectId.isValid(t));
            tagDocs = await Tag.find({ _id: { $in: validIds } }).lean();
            if (tagDocs.length !== validIds.length) errors.push('one or more tags do not exist');
        }
        const newTagNames: string[] = Array.isArray(payload.newTagNames)
            ? payload.newTagNames.map((n: any) => String(n || '').trim()).filter(Boolean)
            : [];

        const isPod = payload.blankId !== undefined && payload.blankId !== null && payload.blankId !== '';

        const images: string[] = Array.isArray(payload.images) ? payload.images.filter((i: any) => typeof i === 'string' && i.trim()) : [];
        if (!isPod && (!partial || payload.images !== undefined)) {
            if (images.length === 0) errors.push('at least one image/mockup is required');
        }

        const usesPrintify = payload.product_type === 'POD_TEMPLATE' || !!payload.printify;
        let variants: VariantInput[] = Array.isArray(payload.variants) ? payload.variants : [];
        if (!isPod && (!partial || payload.variants !== undefined || payload.price !== undefined)) {
            if (variants.length === 0) {
                if (typeof payload.price === 'number') {
                    variants = [{ price: payload.price, stock: payload.stock ?? 100 }];
                } else {
                    errors.push('at least one variant is required');
                }
            }
            variants.forEach((v, i) => {
                if (typeof v.price !== 'number' || v.price <= 0) errors.push(`variant[${i}].price must be > 0`);
                if (v.stock !== undefined && (typeof v.stock !== 'number' || v.stock < 0)) errors.push(`variant[${i}].stock must be >= 0`);


                if (usesPrintify && !v.sku) errors.push(`variant[${i}] from Printify must have a sku`);
            });
        }

        let blank: Blank | undefined;
        let podVariants: { sku: string; color?: string; size?: string; material?: string; base_cost?: number; markup: number; stock: number }[] | undefined;
        let designPlacements: any[] | undefined;
        if (isPod) {
            const currentSellerId = payload._sellerId || opts.sellerId;
            try {
                blank = await BlankClient.getBlank(payload.blankId, currentSellerId);
            } catch (e: any) {
                errors.push(`không lấy được phôi: ${e.message}`);
            }
            if (blank && blank.is_active === false) errors.push('phôi không còn cung ứng');
            if (payload.blankId && !blank) errors.push('phôi không tồn tại');

            const rawVars = Array.isArray(payload.variants) ? payload.variants : [];
            if (rawVars.length === 0) errors.push('cần ít nhất 1 biến thể (chọn từ phôi)');
            podVariants = [];
            const seenSku = new Set<string>();
            rawVars.forEach((v: any, i: number) => {
                const vari = blank?.variations.find(bv => bv.sku === v.sku);
                const sku = String(v.sku || `custom-${i}`).trim();
                if (seenSku.has(sku)) { errors.push(`variant[${i}].sku bị trùng`); return; }
                seenSku.add(sku);
                const markup = Number(v.markup ?? 0);
                if (!Number.isFinite(markup) || markup < 0) errors.push(`variant[${i}].markup phải là số >= 0`);
                const stock = Number(v.stock ?? 100);
                if (!Number.isFinite(stock) || stock < 0) errors.push(`variant[${i}].stock phải là số >= 0`);
                podVariants!.push({
                    sku,
                    color: v.color || vari?.color || 'Màu mặc định',
                    size: v.size || vari?.size || 'Freesize',
                    material: v.material || vari?.material || (blank as any)?.material || 'Cotton',
                    base_cost: Number(v.base_cost ?? vari?.base_cost ?? 50000),
                    markup,
                    stock
                });
            });

            const rawPl = Array.isArray(payload.designPlacements) ? payload.designPlacements : [];
            if (rawPl.length === 0) errors.push('cần ít nhất 1 thiết kế đặt lên phôi (designPlacements)');
            designPlacements = [];
            const ownDesign = async (id: string): Promise<boolean> => {
                if (!id || !mongoose.Types.ObjectId.isValid(id)) return false;
                const d = await Design.findById(id).lean();
                if (!d) return false;
                if (payload._sellerId && d.seller_id.toString() !== String(payload._sellerId)) return false;
                return true;
            };
            let totalContentLayers = 0;
            for (let i = 0; i < rawPl.length; i++) {
                const p = rawPl[i];
                const key = p.print_area_key || (blank?.print_areas?.[0]?.key ?? 'front');
                const rawLayers = Array.isArray(p.layers) ? p.layers : null;

                if (rawLayers) {
                    const layers: any[] = [];
                    for (let j = 0; j < rawLayers.length; j++) {
                        const l = rawLayers[j];
                        const scale = Number(l.scale ?? 1);
                        if (!Number.isFinite(scale) || scale <= 0) { errors.push(`layer[${i}.${j}].scale phải > 0`); continue; }
                        const base = {
                            x: Number(l.x ?? 0) || 0, y: Number(l.y ?? 0) || 0, scale,
                            rotation: Number.isFinite(Number(l.rotation)) ? Number(l.rotation) : 0,
                        };
                        if (l.type === 'image') {
                            if (!(await ownDesign(l.design_id))) { errors.push(`layer[${i}.${j}] ảnh không tồn tại hoặc không thuộc về bạn`); continue; }
                            layers.push({ type: 'image', design_id: l.design_id, width: Number(l.width) || undefined, ...base });
                            totalContentLayers++;
                        } else if (l.type === 'text') {
                            const text = String(l.text ?? '').trim();
                            if (!text) { errors.push(`layer[${i}.${j}] text rỗng`); continue; }
                            layers.push({
                                type: 'text', text: text.slice(0, 120),
                                font_family: l.font_family, font_size: Number(l.font_size) || 40,
                                font_weight: l.font_weight, color: l.color || '#1a1a1a', align: l.align,
                                width: Number(l.width) || undefined, ...base,
                            });
                            totalContentLayers++;
                        } else if (l.type === 'shape') {
                            layers.push({
                                type: 'shape', shape: l.shape || 'rect',
                                fill: l.fill || '#7c3aed', stroke: l.stroke || 'none', stroke_width: Number(l.stroke_width) || 0,
                                width: Number(l.width) || 120, height: Number(l.height) || 120, ...base,
                            });
                            totalContentLayers++;
                        } else {
                            errors.push(`layer[${i}.${j}].type không hợp lệ`);
                        }
                    }
                    if (layers.length) designPlacements.push({ print_area_key: key, x: 0, y: 0, scale: 1, rotation: 0, layers });
                } else {
                    if (!(await ownDesign(p.design_id))) { errors.push(`designPlacements[${i}] thiết kế không tồn tại hoặc không thuộc về bạn`); continue; }
                    const scale = Number(p.scale ?? 1);
                    if (!Number.isFinite(scale) || scale <= 0) { errors.push(`designPlacements[${i}].scale phải > 0`); continue; }
                    const rotation = Number(p.rotation ?? 0);
                    designPlacements.push({
                        design_id: p.design_id, print_area_key: key,
                        x: Number(p.x ?? 0) || 0, y: Number(p.y ?? 0) || 0,
                        scale, rotation: Number.isFinite(rotation) ? rotation : 0,
                    });
                    totalContentLayers++;
                }
            }
            if (rawPl.length > 0 && totalContentLayers === 0 && !errors.length) errors.push('cần ít nhất 1 nội dung thiết kế trên phôi');
        }

        if (errors.length) throw new ValidationError(errors);

        return {
            title,
            description,
            images,
            category: category ? { _id: category._id, name: category.name } : (null as any),
            tagDocs: tagDocs.map(t => ({ _id: t._id, name: t.name })),
            newTagNames,
            variants,
            usesPrintify,
            isPod,
            blank,
            podVariants,
            designPlacements,
        };
    }

    static async uniqueSlug(title: string, excludeId?: string): Promise<string> {
        const base = generateSlug(title);
        let slug = base;
        let n = 1;
        while (true) {
            const clash: any = await MongoProduct.findOne({ slug }).select('_id').lean();
            if (!clash || (excludeId && clash._id.toString() === excludeId)) return slug;
            n += 1;
            slug = `${base}-${n}`;
        }
    }

    private static async writeVariants(productId: mongoose.Types.ObjectId, variants: VariantInput[]) {
        await MongoVariant.deleteMany({ product_id: productId });
        const docs = variants.map((v, i) => ({
            product_id: productId,
            sku: v.sku || `SKU-${productId.toString().slice(-6)}-${i + 1}`,
            color: v.color,
            size: v.size,
            material: v.material,
            mockup_image: v.mockup_image,
            base_cost: mongoose.Types.Decimal128.fromString(((v.base_cost ?? (v.price! * 0.6)) || 0).toString()),
            retail_price: mongoose.Types.Decimal128.fromString((v.price || 0).toString()),
            stock_quantity: v.stock ?? 100,
            is_active: true,
        }));
        await MongoVariant.insertMany(docs);
        await syncProductDenorm(productId);
    }

    static async resolveProposedTags(names: string[], sellerId: string): Promise<{ docs: { _id: mongoose.Types.ObjectId; name: string }[]; proposed: number }> {
        const docs: { _id: mongoose.Types.ObjectId; name: string }[] = [];
        let proposed = 0;
        for (const name of names) {
            const slug = generateSlug(name);
            if (!slug) continue;
            let tag: any = await Tag.findOne({ slug }).lean();
            if (!tag) {
                tag = await Tag.create({ name, slug, status: 'pending', proposed_by: sellerId });
                proposed += 1;
            }
            docs.push({ _id: tag._id, name: tag.name });
        }
        return { docs, proposed };
    }


    private static async resolveShop(sellerId: string) {
        const ownerId = new mongoose.Types.ObjectId(sellerId);
        let shop = await Shop.findOne({ owner_id: ownerId });
        if (!shop) {
            const owner: any = await User.findById(ownerId).select('full_name email').lean();
            const displayName = owner?.full_name || owner?.email?.split('@')[0] || 'Gian hàng mới';
            shop = await Shop.create({
                owner_id: ownerId,
                shop_name: `Xưởng ${displayName}`,
                slug: await ProductsService.uniqueShopSlug(displayName, sellerId),
                average_rating: 5.0,
                listing_count: 0,
            });
        }
        return shop;
    }

    private static async uniqueShopSlug(name: string, sellerId: string): Promise<string> {
        const base = generateSlug(name) || `shop-${sellerId.slice(-6)}`;
        let slug = base;
        let n = 1;
        while (await Shop.exists({ slug })) {
            n += 1;
            slug = `${base}-${n}`;
        }
        return slug;
    }

    private static async assertOwnership(mp: any, actor: ProductActor) {
        if (normalizeRole(actor.role) === 'admin') return;
        const shop = await Shop.findById(mp.shop_id).lean();
        if (!shop || shop.owner_id.toString() !== actor.id) {
            throw new ForbiddenError('Bạn chỉ có thể thao tác trên sản phẩm của gian hàng mình');
        }
    }

    private static buildQuery(base: any, filter?: ProductFilterQueryDTO): any {
        const query: any = { ...base };

        if (filter?.status && filter.status !== 'ALL') {
            query.listing_status = filter.status === 'OUT_OF_STOCK' ? 'ACTIVE' : filter.status;
        }

        if (filter?.category && filter.category.trim() !== ''
            && filter.category !== 'Tất cả danh mục' && filter.category !== 'ALL') {
            const safeCat = filter.category.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            query.categories = { $regex: safeCat, $options: 'i' };
        }

        if (filter?.search && filter.search.trim() !== '') {
            const s = filter.search.trim();
            const safeRegex = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            query.$or = [
                { title: { $regex: safeRegex, $options: 'i' } },
                { description: { $regex: safeRegex, $options: 'i' } },
                { tags: { $regex: safeRegex, $options: 'i' } }
            ];
        }

        return query;
    }

    private static async page(query: any, filter?: ProductFilterQueryDTO): Promise<PaginatedProductsResponseDTO> {
        const page = Math.max(1, Number(filter?.page) || 1);
        const limit = Math.max(1, Number(filter?.limit || filter?.pageSize) || 6);
        const skip = (page - 1) * limit;

        const sort = filter?.sort;
        let docsPromise: Promise<any[]>;
        if (sort === 'price_asc' || sort === 'price_desc' || sort === 'stock_asc' || sort === 'stock_desc') {
            const dir = sort.endsWith('_asc') ? 1 : -1;
            const field = sort.startsWith('price') ? '_minPrice' : '_totalStock';
            docsPromise = MongoProduct.aggregate([
                { $match: query },
                {
                    $lookup: {
                        from: 'product_variants',
                        localField: '_id',
                        foreignField: 'product_id',
                        as: '_variants'
                    }
                },
                {
                    $addFields: {
                        _minPrice: { $min: '$_variants.retail_price' },
                        _totalStock: { $sum: '$_variants.stock_quantity' }
                    }
                },
                { $sort: { [field]: dir, created_at: -1 } },
                { $skip: skip },
                { $limit: limit }
            ]).exec();
        } else if (filter?.search && (!sort || sort === 'relevance')) {
            // SEO Nội sàn: Ưu tiên hiển thị sản phẩm của Shop có điểm uy tín cao (SRS)
            docsPromise = MongoProduct.aggregate([
                { $match: query },
                {
                    $lookup: {
                        from: 'shops',
                        localField: 'shop_id',
                        foreignField: '_id',
                        as: '_shop'
                    }
                },
                {
                    $addFields: {
                        _reputationScore: { $ifNull: [{ $arrayElemAt: ['$_shop.reputation_score', 0] }, 100] }
                    }
                },
                { $sort: { _reputationScore: -1, created_at: -1 } },
                { $skip: skip },
                { $limit: limit }
            ]).exec();
        } else {
            const sortOption: any = sort === 'rank_asc'
                ? { display_rank: 1, created_at: -1 }
                : { created_at: -1 };
            docsPromise = MongoProduct.find(query).sort(sortOption).skip(skip).limit(limit).lean().exec();
        }

        const [total, docs] = await Promise.all([
            MongoProduct.countDocuments(query),
            docsPromise
        ]);
        const totalPages = Math.max(1, Math.ceil(total / limit));

        const items = await ProductsService.mapMany(docs);
        return { items, total, page, limit, totalPages };
    }
    private static async mapMany(docs: any[]): Promise<ProductItemResponseDTO[]> {
        if (docs.length === 0) return [];

        const productIds = docs.map(p => p._id);
        const shopIds = [...new Set(docs.map(p => p.shop_id).filter(Boolean).map((s: any) => s.toString()))];

        const [allVariants, allShops] = await Promise.all([
            MongoVariant.find({ product_id: { $in: productIds } }).lean(),
            Shop.find({ _id: { $in: shopIds.map(id => new mongoose.Types.ObjectId(id)) } }).lean()
        ]);

        const variantsByProductId = new Map<string, any[]>();
        for (const v of allVariants) {
            const pid = v.product_id.toString();
            if (!variantsByProductId.has(pid)) variantsByProductId.set(pid, []);
            variantsByProductId.get(pid)!.push(v);
        }

        const shopsById = new Map<string, any>();
        for (const s of allShops) shopsById.set(s._id.toString(), s);

        return docs.map(mp => mapToProductItemResponse(
            mp,
            variantsByProductId.get(mp._id.toString()) || [],
            shopsById.get(mp.shop_id?.toString())
        ));
    }

    public static async invalidateProductCache(productId?: string): Promise<void> {
        try {
            await Promise.all([
                cacheService.delByPattern('vietcraft:products:list:*'),
                cacheService.delByPattern('vietcraft:products:related:*'),
                cacheService.del('vietcraft:shops:featured'),
                productId ? cacheService.del(`vietcraft:products:detail:${productId}`) : Promise.resolve(),
            ]);
        } catch (err: any) {
            logger.warn(`Failed to invalidate product cache: ${err.message}`);
        }
    }

    static async getAll(filter?: ProductFilterQueryDTO): Promise<PaginatedProductsResponseDTO> {
        const cacheKey = `vietcraft:products:list:${cacheService.hashKey(filter)}`;
        return cacheService.getOrSet(cacheKey, async () => {
            const base: any = { ...PUBLIC_QUERY };

            if (filter?.sellerId && mongoose.Types.ObjectId.isValid(filter.sellerId)) {
                const sellerShop = await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(filter.sellerId) }).lean();
                if (!sellerShop) return { items: [], total: 0, page: 1, limit: Number(filter?.limit || filter?.pageSize) || 6, totalPages: 0 };
                base.shop_id = sellerShop._id;
            } else if (filter?.shopId) {
                if (mongoose.Types.ObjectId.isValid(filter.shopId)) {
                    base.shop_id = new mongoose.Types.ObjectId(filter.shopId);
                } else {
                    const shopBySlug = await Shop.findOne({ slug: filter.shopId }).lean();
                    if (shopBySlug) {
                        base.shop_id = shopBySlug._id;
                    }
                }
            }

            return ProductsService.page(ProductsService.buildQuery(base, filter), filter);
        }, 120);
    }

    /**
     * Tìm kiếm sản phẩm thông minh kết hợp tiếng Việt (có dấu + không dấu),
     * Điểm liên quan (Relevance Text Score + Exact Match Bonus) và Điểm uy tín Gian hàng (SRS Boost).
     */
    static async search(params: SearchProductsParams): Promise<PaginatedProductsResponseDTO> {
        const q = (typeof params.q === 'string' ? params.q : '').slice(0, 100).trim();
        const norm = normalizeVi(q);
        const terms = extractSearchTerms(q, 8);
        const page = Math.max(1, Number(params.page) || 1);
        const limit = Math.min(48, Math.max(1, Number(params.limit || params.pageSize) || 12));
        const useText = terms.length > 0;

        // Ghi nhận lịch sử tìm kiếm: CHỈ ghi khi trang đầu tiên (page === 1) và tìm kiếm gốc
        // Tránh bị thổi phồng khi chuyển trang hoặc thay đổi bộ lọc giá/sắp xếp
        if (q && q.length >= 2 && page === 1 && !params.sort && !params.category && !params.minPrice && !params.maxPrice) {
            SearchLog.create({
                keyword: q,
                user_id: params.userId && mongoose.Types.ObjectId.isValid(params.userId) ? new mongoose.Types.ObjectId(params.userId) : undefined
            }).catch(() => {});
        }

        const match: any = {
            status: 'PUBLISHED',
            is_hidden: { $ne: true },
            listing_status: 'ACTIVE',
            moderation_status: 'APPROVED',
        };

        if (useText) {
            match.$text = { $search: terms.map(t => `"${t}"`).join(' ') };
        }

        const andConditions: any[] = [];

        if (params.category && params.category !== 'ALL' && params.category !== 'Tất cả danh mục') {
            const rawCat = params.category.trim();
            if (/^[0-9a-fA-F]{24}$/.test(rawCat)) {
                andConditions.push({
                    $or: [
                        { category_ids: new mongoose.Types.ObjectId(rawCat) },
                        { categories_norm: normalizeVi(rawCat) }
                    ]
                });
            } else {
                const normCat = normalizeVi(rawCat);
                andConditions.push({
                    $or: [
                        { categories_norm: normCat },
                        { categories: { $regex: escapeRegex(rawCat), $options: 'i' } }
                    ]
                });
            }
        }

        const pType = params.productType || params.craftType;
        if (pType && pType !== 'ALL') {
            match.product_type = pType;
        }

        if (params.location && params.location.trim()) {
            match.location = { $regex: escapeRegex(params.location.trim()), $options: 'i' };
        }

        if (params.rating) {
            match.average_rating = { $gte: Number(params.rating) };
        }

        if (params.minPrice != null && params.minPrice !== '') {
            match.max_price = { $gte: Number(params.minPrice) };
        }

        if (params.maxPrice != null && params.maxPrice !== '') {
            match.min_price = { $lte: Number(params.maxPrice) };
        }

        if (params.inStockOnly === true || params.inStockOnly === 'true') {
            andConditions.push({
                $or: [
                    { product_type: 'POD_TEMPLATE' }, // POD là in theo yêu cầu, luôn sẵn sàng phục vụ
                    { total_stock: { $gt: 0 } },
                    { listing_status: 'ACTIVE', product_type: { $ne: 'READY_TO_SHIP' } }
                ]
            });
        }

        if (andConditions.length > 0) {
            match.$and = andConditions;
        }

        const queryHasTone = hasTone(q);
        const qLower = nfcLower(q);

        const relevance = {
            $add: [
                useText ? { $meta: 'textScore' } : 0,
                useText ? { $cond: [{ $regexMatch: { input: '$title_norm', regex: escapeRegex(norm) } }, 3, 0] } : 0,
                useText && queryHasTone ? { $cond: [{ $regexMatch: { input: '$title_lc', regex: escapeRegex(qLower) } }, 4, 0] } : 0,
                { $multiply: ['$_reputationScore', 0.02] }, // SRS 0-100 -> tối đa +2 điểm
                { $multiply: [{ $ifNull: ['$average_rating', 0] }, 0.3] },
                { $multiply: [{ $ln: { $add: [{ $ifNull: ['$sold_count', 0] }, 1] } }, 0.2] },
            ]
        };

        const SORTS: Record<string, any> = {
            relevance:   { _relevance: -1, created_at: -1 },
            newest:      { created_at: -1 },
            price_asc:   { min_price: 1, created_at: -1 },
            price_desc:  { max_price: -1, created_at: -1 },
            rating_desc: { average_rating: -1, created_at: -1 },
            best_seller: { sold_count: -1, created_at: -1 },
        };

        const sortStage = SORTS[params.sort as string] ?? SORTS.relevance;

        let [res] = await MongoProduct.aggregate([
            { $match: match },
            {
                $lookup: {
                    from: 'shops',
                    localField: 'shop_id',
                    foreignField: '_id',
                    as: '_shop',
                    pipeline: [{ $project: { reputation_score: 1 } }]
                }
            },
            {
                $addFields: {
                    _reputationScore: { $ifNull: [{ $arrayElemAt: ['$_shop.reputation_score', 0] }, 100] },
                }
            },
            { $addFields: { _relevance: relevance } },
            {
                $project: {
                    title_prefixes: 0,
                    description: 0,
                    description_norm: 0,
                    design_placements: 0,
                    _shop: 0
                }
            },
            { $sort: sortStage },
            {
                $facet: {
                    items: [
                        { $skip: (page - 1) * limit },
                        { $limit: limit },
                    ],
                    total: [{ $count: 'n' }],
                }
            },
        ], { allowDiskUse: true });

        // Fallback khi 0 kết quả: nếu total === 0 và có terms, chạy lại với title_prefixes
        if ((res?.total?.[0]?.n ?? 0) === 0 && useText) {
            const fallbackMatch = { ...match };
            delete fallbackMatch.$text;
            fallbackMatch.title_prefixes = { $all: terms.map(t => t.slice(0, 10)) };

            const fallbackRelevance = {
                $add: [
                    { $cond: [{ $regexMatch: { input: '$title_norm', regex: escapeRegex(norm) } }, 3, 0] },
                    queryHasTone ? { $cond: [{ $regexMatch: { input: '$title_lc', regex: escapeRegex(qLower) } }, 4, 0] } : 0,
                    { $multiply: ['$_reputationScore', 0.02] },
                    { $multiply: [{ $ifNull: ['$average_rating', 0] }, 0.3] },
                    { $multiply: [{ $ln: { $add: [{ $ifNull: ['$sold_count', 0] }, 1] } }, 0.2] },
                ]
            };

            const [fallbackRes] = await MongoProduct.aggregate([
                { $match: fallbackMatch },
                {
                    $lookup: {
                        from: 'shops',
                        localField: 'shop_id',
                        foreignField: '_id',
                        as: '_shop',
                        pipeline: [{ $project: { reputation_score: 1 } }]
                    }
                },
                {
                    $addFields: {
                        _reputationScore: { $ifNull: [{ $arrayElemAt: ['$_shop.reputation_score', 0] }, 100] },
                    }
                },
                { $addFields: { _relevance: fallbackRelevance } },
                {
                    $project: {
                        title_prefixes: 0,
                        description: 0,
                        description_norm: 0,
                        design_placements: 0,
                        _shop: 0
                    }
                },
                { $sort: sortStage },
                {
                    $facet: {
                        items: [
                            { $skip: (page - 1) * limit },
                            { $limit: limit },
                        ],
                        total: [{ $count: 'n' }],
                    }
                },
            ], { allowDiskUse: true });

            if ((fallbackRes?.total?.[0]?.n ?? 0) > 0) {
                res = fallbackRes;
            }
        }

        const rawDocs = res?.items || [];
        const total = res?.total?.[0]?.n ?? 0;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const items = await ProductsService.mapMany(rawDocs);

        return { items, total, page, limit, totalPages };
    }

    /**
     * Gợi ý nhanh (Search-as-you-type) phục vụ Dropdown Popover tại Header.
     * Trả về kết quả tức thì (< 30ms): Top 4 sản phẩm, Top 2 gian hàng, Top 3 danh mục.
     */
    static async suggest(queryStr?: string): Promise<SuggestResultDTO> {
        const q = (typeof queryStr === 'string' ? queryStr : '').slice(0, 60).trim();
        if (!q) {
            return { products: [], shops: [], categories: [] };
        }

        const norm = normalizeVi(q);
        const terms = extractSearchTerms(q, 4).map(t => t.slice(0, 12));
        const safeRegex = escapeRegex(norm);
        const slugQ = norm.replace(/\s+/g, '-');
        const safeSlugQ = escapeRegex(slugQ);

        const prodMatch: any = {
            status: 'PUBLISHED',
            is_hidden: { $ne: true },
            listing_status: 'ACTIVE',
            moderation_status: 'APPROVED',
        };

        if (terms.length > 0) {
            // Tận dụng chỉ mục IXSCAN trên title_prefixes, tags_norm, categories_norm và title_norm (không dùng 'i' để giữ bounded index scan)
            prodMatch.$or = [
                { title_prefixes: norm },
                { title_prefixes: { $all: terms } },
                { tags_norm: { $all: terms } },
                { categories_norm: { $all: terms } },
                { title_norm: { $regex: '^' + safeRegex } }
            ];
        }

        const [matchingProducts, matchingShops, matchingCategories] = await Promise.all([
            MongoProduct.find(prodMatch)
                .select('_id title slug images min_price original_price average_rating rating_count')
                .sort({ average_rating: -1, created_at: -1 })
                .limit(4)
                .lean(),

            Shop.find({
                reputation_tier: { $ne: 'RESTRICTED' },
                status: 'ACTIVE',
                $or: [
                    { shop_name_norm: { $regex: '^' + safeRegex } },
                    { slug: { $regex: '^' + safeSlugQ } }
                ]
            })
                .select('_id shop_name slug logo reputation_score reputation_tier')
                .sort({ reputation_score: -1 })
                .limit(2)
                .lean(),

            Category.find({
                is_active: true,
                $or: [
                    { name_norm: { $regex: '^' + safeRegex } },
                    { slug: { $regex: '^' + safeSlugQ } }
                ]
            })
                .select('_id name slug')
                .limit(3)
                .lean()
        ]);

        return {
            products: matchingProducts.map((p: any) => ({
                id: p._id.toString(),
                title: p.title,
                thumbnail: Array.isArray(p.images) && p.images[0] ? p.images[0] : '',
                price: (p.min_price && p.min_price > 0) ? p.min_price : (p.original_price ?? 0),
                average_rating: (p.rating_count ?? 0) > 0 ? (p.average_rating ?? 0) : 0,
                slug: p.slug
            })),
            shops: matchingShops.map((s: any) => ({
                id: s._id.toString(),
                name: s.shop_name,
                slug: s.slug,
                logo: s.logo,
                reputationScore: s.reputation_score ?? 100,
                reputationTier: s.reputation_tier || 'NORMAL'
            })),
            categories: matchingCategories.map((c: any) => ({
                id: c._id.toString(),
                name: c.name,
                slug: c.slug
            }))
        };
    }



    static async getMine(actor: ProductActor, filter?: ProductFilterQueryDTO): Promise<PaginatedProductsResponseDTO> {
        const limit = Number(filter?.limit || filter?.pageSize) || 6;

        const base: any = { is_hidden: { $ne: true } };
        if (normalizeRole(actor.role) !== 'admin') {
            const shop = await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(actor.id) }).lean();
            if (!shop) return { items: [], total: 0, page: 1, limit, totalPages: 0 };
            base.shop_id = shop._id;
        }

        return ProductsService.page(ProductsService.buildQuery(base, filter), filter);
    }

    static async getById(id: string, opts: { includeHidden?: boolean } = {}): Promise<ProductItemResponseDTO> {
        if (!mongoose.Types.ObjectId.isValid(id)) throw new Error('Không tìm thấy sản phẩm.');

        const fetchProduct = async () => {
            const query: any = opts.includeHidden
                ? { _id: new mongoose.Types.ObjectId(id) }
                : { _id: new mongoose.Types.ObjectId(id), ...PUBLIC_QUERY };

            const mp = await MongoProduct.findOne(query).lean();
            if (!mp) throw new Error('Không tìm thấy sản phẩm.');

            const [variants, shop] = await Promise.all([
                MongoVariant.find({ product_id: mp._id }).lean(),
                Shop.findById(mp.shop_id).lean()
            ]);
            return mapToProductItemResponse(mp, variants, shop);
        };

        if (opts.includeHidden) {
            return fetchProduct();
        }

        const cacheKey = `vietcraft:products:detail:${id}`;
        return cacheService.getOrSet(cacheKey, fetchProduct, 300);
    }

    public static async sanitizeImages(images: string[]): Promise<string[]> {
        if (!Array.isArray(images) || images.length === 0) return [];
        const result: string[] = [];
        for (const img of images) {
            if (img && typeof img === 'string' && img.startsWith('data:image')) {
                if (isCloudinaryEnabled()) {
                    try {
                        const uploaded = await uploadImage(img, { folder: 'products' });
                        result.push(uploaded.url);
                        continue;
                    } catch (e: any) {
                        logger.warn('Failed to auto-upload base64 image to Cloudinary: ' + e.message);
                    }
                }
            }
            if (img) result.push(img);
        }
        return result;
    }

    static async getByIds(ids: (string | mongoose.Types.ObjectId)[]): Promise<ProductItemResponseDTO[]> {
        if (!ids || ids.length === 0) return [];
        const validIds = ids
            .filter(id => mongoose.Types.ObjectId.isValid(id.toString()))
            .map(id => typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id);
        if (validIds.length === 0) return [];
        const docs = await MongoProduct.find({ _id: { $in: validIds } }).lean();
        return this.mapMany(docs);
    }

    static async getRelated(id: string, category?: string, limit = 4): Promise<ProductItemResponseDTO[]> {
        if (!mongoose.Types.ObjectId.isValid(id)) return [];
        const cacheKey = `vietcraft:products:related:${id}:${category || 'auto'}:${limit}`;
        return cacheService.getOrSet(cacheKey, async () => {
            const self = new mongoose.Types.ObjectId(id);

            let cat = category;
            if (!cat) {
                const p = await MongoProduct.findById(self).select('categories').lean();
                cat = p?.categories?.[0];
            }

            const base: any = { ...PUBLIC_QUERY, listing_status: 'ACTIVE', _id: { $ne: self } };
            let docs = await MongoProduct.find(cat ? { ...base, categories: cat } : base)
                .limit(limit).lean();

            if (docs.length < limit) {
                const extra = await MongoProduct.find({
                    ...base,
                    _id: { $nin: [self, ...docs.map(p => p._id)] }
                }).limit(limit - docs.length).lean();
                docs = [...docs, ...extra];
            }

            return ProductsService.mapMany(docs);
        }, 600);
    }

    static async getFeaturedShops(): Promise<any[]> {
        return cacheService.getOrSet('vietcraft:shops:featured', async () => {
            return Shop.find()
                .select('shop_name slug logo banner average_rating listing_count')
                .sort({ average_rating: -1, listing_count: -1 })
                .limit(5)
                .lean();
        }, 600);
    }

    private static async createStructured(sellerId: string, payload: any): Promise<ProductItemResponseDTO> {

        const data = await ProductsService.validate({ ...payload, _sellerId: sellerId });
        const shop = await ProductsService.resolveShop(sellerId);
        const slug = await ProductsService.uniqueSlug(data.title);

        const proposed = await ProductsService.resolveProposedTags(data.newTagNames, sellerId);
        const allTags = [...data.tagDocs, ...proposed.docs];

        let images = data.images;
        let variantsToWrite: VariantInput[] = data.variants;
        let podFields: any = {};
        if (data.isPod && data.blank) {
            const built = await ProductsService.buildPodArtifacts(
                data.blank, data.podVariants!, data.designPlacements!, data.category?._id?.toString() ?? null,
            );
            images = (Array.isArray(payload.images) && payload.images.length > 0)
                ? payload.images
                : built.images;
            variantsToWrite = built.variants;
            podFields = {
                product_type: 'POD_TEMPLATE',
                customization_type: 'ONLINE_MOCKUP',
                blank_id: payload.blankId,
                printer_id: payload.printerId || (data.blank as any)?.printer_id || shop.printer_partner?.printer_id,
                printer_name: payload.printerName || (data.blank as any)?.printer_name || shop.printer_partner?.printer_name || 'Xưởng in đối tác',
                design_placements: data.designPlacements!.map((p: any) => ({
                    ...p,
                    design_id: p.design_id ? new mongoose.Types.ObjectId(p.design_id) : undefined,
                    layers: (p.layers || []).map((l: any) => l.type === 'image' && l.design_id
                        ? { ...l, design_id: new mongoose.Types.ObjectId(l.design_id) }
                        : l),
                })),
            };
        }

        if (payload.thumbnail && images.includes(payload.thumbnail)) {
            images = [payload.thumbnail, ...images.filter((img: string) => img !== payload.thumbnail)];
        }
        images = await ProductsService.sanitizeImages(images);

        const mp = await MongoProduct.create({
            shop_id: shop._id,
            shipping_profile_id: new mongoose.Types.ObjectId(),
            title: data.title,
            slug,
            description: data.description,
            product_type: data.isPod ? 'POD_TEMPLATE' : (data.usesPrintify ? 'POD_TEMPLATE' : 'READY_TO_SHIP'),
            allow_customization: false,
            images,
            categories: [data.category.name],
            category_ids: [data.category._id],
            tags: allTags.map(t => t.name),
            tag_ids: allTags.map(t => t._id),
            weight_g: payload.weight_g ?? 500,
            dimensions_cm: payload.dimensions_cm ?? { length: 10, width: 10, height: 10 },
            status: 'PUBLISHED',
            listing_status: 'ACTIVE',
            moderation_status: 'APPROVED',
            ...podFields,
        });

        await ProductsService.writeVariants(mp._id, variantsToWrite);
        if (allTags.length) {
            await Tag.updateMany({ _id: { $in: allTags.map(t => t._id) } }, { $inc: { product_count: 1 } });
        }

        await Shop.updateOne({ _id: shop._id }, { $inc: { listing_count: 1 } });
        await ProductsService.invalidateProductCache(mp._id.toString());
        return ProductsService.getById(mp._id.toString(), { includeHidden: true });
    }


    private static async resolveFlatCatalog(
        payload: { categoryId?: string; tagIds?: string[]; newTagNames?: string[] },
        sellerId: string,
        opts: { required: boolean }
    ): Promise<{ category?: { _id: mongoose.Types.ObjectId; name: string }; tags?: { _id: mongoose.Types.ObjectId; name: string }[] }> {
        const errors: string[] = [];
        const out: { category?: any; tags?: any[] } = {};

        const hasCategory = payload.categoryId !== undefined;
        if (opts.required || hasCategory) {
            if (!payload.categoryId || !mongoose.Types.ObjectId.isValid(payload.categoryId)) {
                errors.push('Vui lòng chọn danh mục');
            } else {
                const category: any = await Category.findById(payload.categoryId).lean();
                if (!category) errors.push('Danh mục không tồn tại');
                else if (category.is_active === false) errors.push('Danh mục đã bị ẩn, vui lòng chọn danh mục khác');
                else out.category = { _id: category._id, name: category.name };
            }
        }

        const hasTags = payload.tagIds !== undefined || payload.newTagNames !== undefined;
        if (opts.required || hasTags) {
            const rawIds = Array.isArray(payload.tagIds) ? payload.tagIds : [];
            const validIds = rawIds.filter(t => mongoose.Types.ObjectId.isValid(t));
            if (validIds.length !== rawIds.length) errors.push('Có thẻ không hợp lệ');

            const docs = await Tag.find({ _id: { $in: validIds } }).lean();
            if (docs.length !== validIds.length) errors.push('Có thẻ không tồn tại');

            const names = Array.isArray(payload.newTagNames)
                ? payload.newTagNames.map((n: any) => String(n || '').trim()).filter(Boolean)
                : [];
            const proposed = names.length
                ? await ProductsService.resolveProposedTags(names, sellerId)
                : { docs: [], proposed: 0 };

            const all = [...docs.map((t: any) => ({ _id: t._id, name: t.name })), ...proposed.docs];

            if (all.length === 0) errors.push('Vui lòng chọn ít nhất 1 thẻ');
            out.tags = all;
        }

        if (errors.length) throw new ValidationError(errors);
        return out;
    }


    private static async createSimple(sellerId: string, payload: ProductFormDataDTO): Promise<ProductItemResponseDTO> {
        const title = String(payload.title || '').trim();
        if (!title) throw new ValidationError(['Tên sản phẩm là bắt buộc']);

        const basePrice = Number(payload.price) || 0;
        if (basePrice <= 0) throw new ValidationError(['Giá bán phải lớn hơn 0']);

        const totalStock = Number(payload.stock) || 0;
        if (totalStock < 0) throw new ValidationError(['Tồn kho không được âm']);
        const catalog = await ProductsService.resolveFlatCatalog(payload, sellerId, { required: true });
        const tags = catalog.tags || [];

        const shop = await ProductsService.resolveShop(sellerId);
        const slug = await ProductsService.uniqueSlug(title);

        let rawImages = payload.images && payload.images.length > 0
            ? [...payload.images]
            : (payload.thumbnail ? [payload.thumbnail] : []);
        const targetCover = payload.thumbnail || rawImages[0];
        if (targetCover && rawImages.includes(targetCover)) {
            rawImages = [targetCover, ...rawImages.filter(img => img !== targetCover)];
        }
        const images = await ProductsService.sanitizeImages(rawImages);

        const mp = await MongoProduct.create({
            shop_id: shop._id,
            shipping_profile_id: new mongoose.Types.ObjectId(),
            title,
            slug,
            description: payload.description || title,
            product_type: 'READY_TO_SHIP',
            allow_customization: false,
            images,
            categories: [catalog.category!.name],
            category_ids: [catalog.category!._id],
            tags: tags.map(t => t.name),
            tag_ids: tags.map(t => t._id),
            weight_g: 500,
            dimensions_cm: { length: 10, width: 10, height: 10 },
            location: payload.location,
            display_rank: payload.rank ?? 1,
            original_price: payload.originalPrice,
            status: 'PUBLISHED',
            listing_status: payload.status === 'OUT_OF_STOCK' ? 'ACTIVE' : (payload.status || 'ACTIVE'),
            moderation_status: 'APPROVED',
        });

        const baseSku = payload.sku || `VC-PRD-${mp._id.toString().substring(18).toUpperCase()}`;
        // Giá người bán nhập là giá họ nhận; niêm yết lên sàn là giá đó cộng hoa hồng.
        // Mức hoa hồng tra theo danh mục chính + loại sản phẩm, không phải mức phẳng của sàn.
        const listPrice = withCommission(
            basePrice,
            await CommissionSetting.resolvePercent(catalog.category!._id.toString(), 'READY_TO_SHIP'),
        );
        await ProductsService.writeVariants(mp._id, ProductsService.colorsToVariants(payload.colors, baseSku, basePrice, totalStock, listPrice));
        if (tags.length) {
            await Tag.updateMany({ _id: { $in: tags.map(t => t._id) } }, { $inc: { product_count: 1 } });
        }
        await Shop.updateOne({ _id: shop._id }, { $inc: { listing_count: 1 } });
        await ProductsService.invalidateProductCache(mp._id.toString());
        logger.info(`Created new product: ${mp._id} (${mp.title})`);
        return ProductsService.getById(mp._id.toString(), { includeHidden: true });
    }


    /**
     * `basePrice` là giá người bán nhận (dùng để suy ra giá vốn), `listPrice` là giá niêm yết
     * đã cộng hoa hồng sàn. Hai số khác nhau nên phải truyền riêng — lấy listPrice tính giá vốn
     * thì giá vốn bị thổi theo hoa hồng.
     */
    private static colorsToVariants(
        colors: ProductColorVariantDTO[] | undefined,
        baseSku: string,
        basePrice: number,
        totalStock: number,
        listPrice: number
    ): VariantInput[] {
        const baseCost = Math.round(basePrice * 0.7);

        if (!colors || colors.length === 0) {
            return [{
                sku: baseSku,
                color: 'Tự nhiên',
                base_cost: baseCost,
                price: listPrice,
                stock: totalStock,
            }];
        }

        const perColor = Math.max(0, Math.floor(totalStock / colors.length));
        return colors.map((c, i) => ({
            sku: `${baseSku}-${i + 1}`,
            color: c.name,
            mockup_image: c.hex,
            base_cost: baseCost,
            price: listPrice,
            stock: i === colors.length - 1 ? totalStock - perColor * (colors.length - 1) : perColor,
        }));
    }


    static async create(sellerId: string, payload: any): Promise<ProductItemResponseDTO> {

        const isStructured = payload?.blankId !== undefined
            || Array.isArray(payload?.designPlacements)
            || Array.isArray(payload?.variants);
        return isStructured
            ? ProductsService.createStructured(sellerId, payload)
            : ProductsService.createSimple(sellerId, payload as ProductFormDataDTO);
    }

    /**
     * Mức hoa hồng áp cho một sản phẩm ĐÃ LƯU, tra theo danh mục chính và loại của nó.
     * Dùng ở đường sửa, nơi chỉ còn document chứ không còn payload gốc.
     */
    private static async resolveProductCommission(mp: any): Promise<number> {
        const categoryId = mp?.category_ids?.[0] ? String(mp.category_ids[0]) : null;
        return CommissionSetting.resolvePercent(categoryId, mp?.product_type || 'READY_TO_SHIP');
    }

    private static async buildPodArtifacts(
        blank: Blank,
        podVariants: { sku: string; color?: string; size?: string; material?: string; base_cost?: number; markup: number; stock: number }[],
        placements: any[],
        /** Danh mục chính của sản phẩm — quyết định mức hoa hồng áp cho biến thể POD. */
        categoryId: string | null
    ): Promise<{ images: string[]; variants: VariantInput[] }> {

        const ids = new Set<string>();
        for (const p of placements) {
            if (p.design_id) ids.add(String(p.design_id));
            for (const l of (p.layers || [])) if (l.type === 'image' && l.design_id) ids.add(String(l.design_id));
        }
        const validIds = [...ids].filter(id => mongoose.Types.ObjectId.isValid(id));
        const designs = validIds.length > 0
            ? await Design.find({ _id: { $in: validIds.map(id => new mongoose.Types.ObjectId(id)) } }).lean()
            : [];
        const designUrl = (id: string) => designs.find(d => d._id.toString() === String(id))?.file_url;

        const mockups: string[] = [];
        for (const p of placements) {
            const area = blank.print_areas?.find(a => a.key === p.print_area_key) || null;
            const rawImage = (area && (area as any).image && typeof (area as any).image === 'string' && (area as any).image.trim() !== '') ? (area as any).image : blank.default_image;
            const blankImage = rawImage || blank.default_image;

            if (Array.isArray(p.layers) && p.layers.length) {

                const layers = p.layers.map((l: any) => l.type === 'image'
                    ? { ...l, designUrl: designUrl(l.design_id) }
                    : l
                ).filter((l: any) => l.type !== 'image' || l.designUrl);
                if (area && (area as any).surface === 'wrap') {
                    mockups.push(await generateWrapMockup(blankImage, layers, {
                        x: p.area?.x ?? area.x,
                        y: p.area?.y ?? area.y,
                        width: p.area?.width ?? area.width,
                        height: p.area?.height ?? area.height,
                        template_w: (area as any).template_w || 2475,
                        template_h: (area as any).template_h || 1155,
                        arc: (area as any).arc || 1.35,
                    }));
                } else {
                    mockups.push(await generateMockupLayers(blankImage, layers));
                }
            } else if (p.design_id) {

                const url = designUrl(p.design_id);
                if (!url) continue;
                mockups.push(await generateMockup(blankImage, url, area, { x: p.x, y: p.y, scale: p.scale, rotation: p.rotation }));
            }
        }
        const images = mockups.length ? mockups : [blank.default_image];

        // Người bán nhận tiền phôi + markup; hoa hồng sàn cộng thêm lên giá niêm yết.
        const commissionPercent = await CommissionSetting.resolvePercent(categoryId, 'POD_TEMPLATE');
        const variants: VariantInput[] = podVariants.map(pv => {
            const vari = blank.variations?.find(v => v.sku === pv.sku);
            const baseCost = pv.base_cost ?? vari?.base_cost ?? 50000;
            return {
                sku: pv.sku,
                color: pv.color || vari?.color || 'Màu mặc định',
                size: pv.size || vari?.size || 'Freesize',
                material: pv.material || vari?.material || (blank as any)?.material || 'Cotton',
                base_cost: baseCost,
                price: withCommission(baseCost + pv.markup, commissionPercent),
                stock: pv.stock,
            };
        });
        return { images, variants };
    }

    static async previewMockups(
        sellerId: string,
        blankId: string,
        designPlacements: any[],
        options?: { colorHex?: string; colors?: { color?: string; color_hex?: string; sku?: string }[] }
    ): Promise<{ images: string[]; byColor: { color: string; color_hex?: string; images: string[] }[] }> {
        if (!blankId) throw new ValidationError(['thiếu blankId']);
        const blank = await BlankClient.getBlank(blankId, sellerId);
        if (!blank) throw new ValidationError(['phôi không tồn tại']);

        const ids = new Set<string>();
        for (const p of (designPlacements || [])) {
            if (p.design_id) ids.add(String(p.design_id));
            for (const l of (p.layers || [])) if (l.type === 'image' && l.design_id) ids.add(String(l.design_id));
        }
        const validIds = [...ids].filter(id => mongoose.Types.ObjectId.isValid(id));
        const designs = validIds.length > 0
            ? await Design.find({ _id: { $in: validIds.map(id => new mongoose.Types.ObjectId(id)) } }).lean()
            : [];
        const ownedUrl = (id: string) => {
            const d = designs.find(x => x._id.toString() === String(id));
            if (!d) return undefined;
            if (d.seller_id.toString() !== String(sellerId)) return undefined;
            return d.file_url;
        };

        const renderPlacements = async (colorHex?: string): Promise<string[]> => {
            const out: string[] = [];
            for (const p of (designPlacements || [])) {
                const area = blank.print_areas?.find(a => a.key === p.print_area_key) || null;
                const rawImage = (area && (area as any).image && typeof (area as any).image === 'string' && (area as any).image.trim() !== '') ? (area as any).image : blank.default_image;
                const blankImage = rawImage || blank.default_image;
                if (!Array.isArray(p.layers) || !p.layers.length) continue;
                const layers = p.layers.map((l: any) => l.type === 'image' ? { ...l, designUrl: ownedUrl(l.design_id) || l.designUrl || l.design?.file_url } : l)
                    .filter((l: any) => l.type !== 'image' || l.designUrl);
                if (!layers.length) continue;
                if (area && (area as any).surface === 'wrap') {
                    out.push(await generateWrapMockup(blankImage, layers, {
                        x: p.area?.x ?? area.x,
                        y: p.area?.y ?? area.y,
                        width: p.area?.width ?? area.width,
                        height: p.area?.height ?? area.height,
                        template_w: (area as any).template_w || 2475,
                        template_h: (area as any).template_h || 1155,
                        arc: (area as any).arc || 1.35,
                    }, colorHex));
                } else {
                    out.push(await generateMockupLayers(blankImage, layers, colorHex));
                }
            }
            return out;
        };

        // Danh sách màu sắc từ options hoặc từ biến thể của phôi do printer khai báo
        const inputColors = (options?.colors && Array.isArray(options.colors) && options.colors.length > 0)
            ? options.colors
            : (blank.variations && blank.variations.length > 0)
                ? blank.variations.map(v => ({ color: v.color || 'Mặc định', color_hex: (v as any).color_hex || resolveColorHex(v.color) }))
                : [];

        const distinctColors: { color: string; color_hex?: string }[] = [];
        const seenColors = new Set<string>();
        for (const item of inputColors) {
            const name = (item.color || 'Mặc định').trim();
            if (name && !seenColors.has(name)) {
                seenColors.add(name);
                distinctColors.push({
                    color: name,
                    color_hex: item.color_hex || resolveColorHex(name)
                });
            }
        }

        const byColor: { color: string; color_hex?: string; images: string[] }[] = [];
        if (distinctColors.length > 0) {
            for (const c of distinctColors) {
                const colorImgs = await renderPlacements(c.color_hex);
                byColor.push({
                    color: c.color,
                    color_hex: c.color_hex,
                    images: colorImgs.length ? colorImgs : [blank.default_image]
                });
            }
        } else {
            const defaultImgs = await renderPlacements(options?.colorHex);
            byColor.push({
                color: 'Mặc định',
                color_hex: options?.colorHex,
                images: defaultImgs.length ? defaultImgs : [blank.default_image]
            });
        }

        const allImages = byColor.flatMap(c => c.images);
        return {
            images: allImages.length ? allImages : [blank.default_image],
            byColor
        };
    }


    private static async updateStructured(mp: any, actor: ProductActor, payload: any): Promise<ProductItemResponseDTO> {
        const id = mp._id.toString();
        for (const forbidden of ['sellerId', 'shop_id', 'shopId', 'status', 'owner_id']) {
            if (payload[forbidden] !== undefined) {
                throw new ForbiddenError(`Field "${forbidden}" cannot be changed via update`);
            }
        }

        const data = await ProductsService.validate(payload, { partial: true, sellerId: mp.seller_id?.toString() || actor.id });

        if (payload.title !== undefined) {
            mp.title = data.title;
            mp.slug = await ProductsService.uniqueSlug(data.title, id);
        }
        if (payload.description !== undefined) mp.description = data.description;
        if (payload.images !== undefined) {
            let imgs = [...data.images];
            const targetCover = payload.thumbnail || imgs[0];
            if (targetCover && imgs.includes(targetCover)) {
                imgs = [targetCover, ...imgs.filter(img => img !== targetCover)];
            }
            mp.images = await ProductsService.sanitizeImages(imgs);
        } else if (payload.thumbnail && Array.isArray(mp.images) && mp.images.includes(payload.thumbnail)) {
            mp.images = [payload.thumbnail, ...mp.images.filter((img: string) => img !== payload.thumbnail)];
        }
        if (payload.categoryId !== undefined && data.category) {
            mp.categories = [data.category.name];
            mp.category_ids = [data.category._id];
        }
        if (payload.tagIds !== undefined || payload.newTagNames !== undefined) {
            const proposed = await ProductsService.resolveProposedTags(data.newTagNames, actor.id);
            const allTags = [...data.tagDocs, ...proposed.docs];
            const oldIds = (mp.tag_ids || []).map((t: any) => t.toString());
            const newIds = allTags.map(t => t._id.toString());
            mp.tags = allTags.map(t => t.name);
            mp.tag_ids = allTags.map(t => t._id) as any;
            const added = newIds.filter(x => !oldIds.includes(x));
            const removed = oldIds.filter((x: string) => !newIds.includes(x));
            if (added.length) await Tag.updateMany({ _id: { $in: added } }, { $inc: { product_count: 1 } });
            if (removed.length) await Tag.updateMany({ _id: { $in: removed } }, { $inc: { product_count: -1 } });
        }
        await mp.save();

        if (payload.variants !== undefined || payload.price !== undefined) {
            await ProductsService.writeVariants(mp._id, data.variants);
        }
        return ProductsService.getById(id, { includeHidden: true });
    }

    private static async updateSimple(mp: any, actor: ProductActor, payload: Partial<ProductFormDataDTO>): Promise<ProductItemResponseDTO> {
        if (payload.price !== undefined) {
            const basePrice = Number(payload.price);
            if (isNaN(basePrice) || basePrice <= 0) {
                throw new ValidationError(['Giá bán phải lớn hơn 0']);
            }
        }
        if (payload.stock !== undefined) {
            const totalStock = Number(payload.stock);
            if (isNaN(totalStock) || totalStock < 0) {
                throw new ValidationError(['Tồn kho không được âm']);
            }
        }

        const catalog = await ProductsService.resolveFlatCatalog(payload, actor.id, { required: false });

        if (catalog.category) {
            mp.categories = [catalog.category.name];
            mp.category_ids = [catalog.category._id];
        }
        if (catalog.tags) {
            const oldIds = (mp.tag_ids || []).map((t: any) => t.toString());
            const newIds = catalog.tags.map(t => t._id.toString());
            mp.tags = catalog.tags.map(t => t.name);
            mp.tag_ids = catalog.tags.map(t => t._id) as any;
            const added = newIds.filter(x => !oldIds.includes(x));
            const removed = oldIds.filter((x: string) => !newIds.includes(x));
            if (added.length) await Tag.updateMany({ _id: { $in: added } }, { $inc: { product_count: 1 } });
            if (removed.length) await Tag.updateMany({ _id: { $in: removed } }, { $inc: { product_count: -1 } });
        }

        if (payload.title !== undefined) {
            mp.title = payload.title;
            mp.slug = await ProductsService.uniqueSlug(payload.title, mp._id.toString());
        }
        if (payload.description !== undefined) mp.description = payload.description;
        if (!catalog.category && payload.category !== undefined) mp.categories = [payload.category];
        if (payload.location !== undefined) mp.location = payload.location;
        if (payload.rank !== undefined) mp.display_rank = payload.rank;
        if (payload.originalPrice !== undefined) mp.original_price = payload.originalPrice;
        if (payload.status !== undefined) {
            mp.listing_status = payload.status === 'OUT_OF_STOCK' ? 'ACTIVE' : payload.status;
        }
        if (payload.images && payload.images.length > 0) {
            let rawImages = [...payload.images];
            const targetCover = payload.thumbnail || rawImages[0];
            if (targetCover && rawImages.includes(targetCover)) {
                rawImages = [targetCover, ...rawImages.filter(img => img !== targetCover)];
            }
            mp.images = await ProductsService.sanitizeImages(rawImages);
        } else if (payload.thumbnail) {
            if (Array.isArray(mp.images) && mp.images.includes(payload.thumbnail)) {
                mp.images = [payload.thumbnail, ...mp.images.filter((img: string) => img !== payload.thumbnail)];
            } else {
                mp.images = await ProductsService.sanitizeImages([payload.thumbnail]);
            }
        }
        await mp.save();

        if (payload.colors && payload.colors.length > 0) {
            const existing = await MongoVariant.find({ product_id: mp._id }).lean();
            const baseSku = payload.sku || existing[0]?.sku?.replace(/-\d+$/, '') || `VC-PRD-${mp._id.toString().substring(18).toUpperCase()}`;
            const totalStock = payload.stock !== undefined
                ? Number(payload.stock)
                : existing.reduce((sum, v) => sum + (Number(v.stock_quantity) || 0), 0);

            // `payload.price` là giá người bán NHẬN, còn giá trong DB là giá NIÊM YẾT (đã gồm
            // hoa hồng). Sửa màu mà không nhập giá thì giữ nguyên giá niêm yết từng đồng, đồng
            // thời bóc hoa hồng ra để giá vốn vẫn tính trên cùng cơ sở như lúc tạo sản phẩm.
            const dbPrice = parseFloat(existing[0]?.retail_price?.toString() || '0');
            const commissionPercent = await ProductsService.resolveProductCommission(mp);
            const basePrice = payload.price !== undefined
                ? Number(payload.price)
                : dbPrice - commissionFromGross(dbPrice, commissionPercent);
            const listPrice = payload.price !== undefined
                ? withCommission(basePrice, commissionPercent)
                : dbPrice;
            await ProductsService.writeVariants(mp._id, ProductsService.colorsToVariants(payload.colors, baseSku, basePrice, totalStock, listPrice));
        } else {
            const updates: any = {};
            if (payload.price !== undefined) {
                const netPrice = Number(payload.price);
                const grossPrice = withCommission(netPrice, await ProductsService.resolveProductCommission(mp));
                updates.retail_price = mongoose.Types.Decimal128.fromString(grossPrice.toString());
                updates.base_cost = mongoose.Types.Decimal128.fromString((netPrice * 0.7).toFixed(0));
            }
            if (payload.stock !== undefined) updates.stock_quantity = Number(payload.stock);
            if (payload.sku !== undefined) updates.sku = payload.sku;
            if (Object.keys(updates).length > 0) {
                await MongoVariant.updateMany({ product_id: mp._id }, updates);
                await syncProductDenorm(mp._id);
            }
        }

        logger.info(`Updated product: ${mp._id} (${mp.title})`);
        return ProductsService.getById(mp._id.toString(), { includeHidden: true });
    }

    static async update(id: string, actor: ProductActor, payload: any): Promise<ProductItemResponseDTO> {
        if (!mongoose.Types.ObjectId.isValid(id)) throw new Error('Không tìm thấy sản phẩm cần cập nhật.');
        const mp = await MongoProduct.findById(id);
        if (!mp) throw new Error('Không tìm thấy sản phẩm cần cập nhật.');
        await ProductsService.assertOwnership(mp, actor);

        const isStructured = payload?.blankId !== undefined
            || Array.isArray(payload?.designPlacements)
            || Array.isArray(payload?.variants);

        const result = await (isStructured
            ? ProductsService.updateStructured(mp, actor, payload)
            : ProductsService.updateSimple(mp, actor, payload as Partial<ProductFormDataDTO>));

        await ProductsService.invalidateProductCache(id);
        return result;
    }

    static async delete(id: string, actor: ProductActor): Promise<{ success: boolean; message: string }> {
        if (!mongoose.Types.ObjectId.isValid(id)) throw new Error('Không tìm thấy sản phẩm cần xóa.');
        const mp = await MongoProduct.findById(id);
        if (!mp) throw new Error('Không tìm thấy sản phẩm cần xóa.');
        await ProductsService.assertOwnership(mp, actor);

        mp.is_hidden = true;
        mp.status = 'UNPUBLISHED';
        mp.listing_status = 'INACTIVE';
        await mp.save();
        await MongoVariant.updateMany({ product_id: mp._id }, { $set: { is_active: false } });
        await syncProductDenorm(mp._id);
        await Shop.updateOne({ _id: mp.shop_id }, { $inc: { listing_count: -1 } });

        await ProductsService.invalidateProductCache(id);
        logger.info(`Soft deleted product: ${id} by ${actor.id}`);
        return { success: true, message: 'Đã xóa sản phẩm thành công.' };
    }

    static async batchDelete(ids: string[], actor: ProductActor): Promise<{ success: boolean; count: number }> {
        const scoped = await ProductsService.scopeIdsToActor(ids, actor);
        if (scoped.length === 0) return { success: true, count: 0 };

        const result = await MongoProduct.updateMany(
            { _id: { $in: scoped } },
            { $set: { is_hidden: true, status: 'UNPUBLISHED', listing_status: 'INACTIVE' } }
        );
        await MongoVariant.updateMany({ product_id: { $in: scoped } }, { $set: { is_active: false } });
        await Promise.all(scoped.map(id => syncProductDenorm(id)));

        await ProductsService.invalidateProductCache();
        logger.info(`Batch soft deleted ${result.modifiedCount} products by ${actor.id}`);
        return { success: true, count: result.modifiedCount };
    }

    static async updateStatus(ids: string[], status: ProductStatus, actor: ProductActor): Promise<{ success: boolean; count: number }> {
        const scoped = await ProductsService.scopeIdsToActor(ids, actor);
        if (scoped.length === 0) return { success: true, count: 0 };

        const mongoStatus = status === 'OUT_OF_STOCK' ? 'ACTIVE' : status;
        const result = await MongoProduct.updateMany(
            { _id: { $in: scoped } },
            { $set: { listing_status: mongoStatus } }
        );

        await ProductsService.invalidateProductCache();
        logger.info(`Batch updated listing_status to ${mongoStatus} for ${result.modifiedCount} products by ${actor.id}`);
        return { success: true, count: result.modifiedCount };
    }

    private static async scopeIdsToActor(ids: string[], actor: ProductActor): Promise<mongoose.Types.ObjectId[]> {
        if (!Array.isArray(ids) || ids.length === 0) return [];
        const validIds = ids
            .filter(id => mongoose.Types.ObjectId.isValid(id))
            .map(id => new mongoose.Types.ObjectId(id));
        if (validIds.length === 0) return [];

        if (normalizeRole(actor.role) === 'admin') return validIds;

        const shop = await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(actor.id) }).lean();
        if (!shop) return [];

        const owned = await MongoProduct.find({ _id: { $in: validIds }, shop_id: shop._id }).select('_id').lean();
        if (owned.length !== validIds.length) {
            logger.warn(`Actor ${actor.id} yêu cầu thao tác trên ${validIds.length} sản phẩm nhưng chỉ sở hữu ${owned.length}`);
        }
        return owned.map(p => p._id);
    }

    static async unpublish(id: string, reason?: string) {
        const mp = await MongoProduct.findById(id);
        if (!mp) throw new Error('Product not found');
        mp.status = 'UNPUBLISHED';
        mp.listing_status = 'INACTIVE';
        mp.unpublish_reason = reason;
        await mp.save();
        await ProductsService.invalidateProductCache(id);
        return ProductsService.getById(id, { includeHidden: true });
    }

    private static async listingIssues(mp: any): Promise<string[]> {
        const variants = await MongoVariant.find({ product_id: mp._id });
        try {
            await ProductsService.validate({
                title: mp.title,
                description: mp.description,
                categoryId: mp.category_ids?.[0]?.toString(),
                tagIds: (mp.tag_ids || []).map((t: any) => t.toString()),
                images: mp.images,
                variants: variants.map(v => ({ price: parseFloat(v.retail_price.toString()), stock: v.stock_quantity, sku: v.sku })),
                product_type: mp.product_type,
            });
            return [];
        } catch (err: any) {
            return Array.isArray(err?.errors) ? err.errors : [err?.message || 'Tin đăng chưa đạt chuẩn'];
        }
    }

    static async republish(id: string): Promise<{ product: any; warnings: string[] }> {
        const mp = await MongoProduct.findById(id);
        if (!mp) throw new Error('Product not found');

        const warnings = await ProductsService.listingIssues(mp);

        mp.status = 'PUBLISHED';
        mp.listing_status = 'ACTIVE';
        mp.unpublish_reason = undefined;
        mp.is_hidden = false;
        await mp.save();
        await ProductsService.invalidateProductCache(id);

        return { product: await ProductsService.getById(id, { includeHidden: true }), warnings };
    }

    static async listActiveCategories() {
        return categoryService.listActive();
    }

    static async listTags() {
        return tagsService.listApproved();
    }
}

export default ProductsService;
