import mongoose from 'mongoose';
import { Product as MongoProduct } from '../infrastructure/models/product.model';
import { ProductVariant as MongoVariant } from '../infrastructure/models/product-variant.model';
import { Shop } from '../infrastructure/models/shop.model';
import { User } from '../../user/infrastructure/models/user.model';
import { Category } from '../../category';
import { categoryService } from '../../category/application/category.service';
import { Tag } from '../../tags';
import { tagsService } from '../../tags/application/tags.service';
import { Design } from '../../design/infrastructure/models/design.model';
import { generateSlug } from '../../../shared/utils/slug';
import { BlankClient, Blank } from './blank-client.service';
import { generateMockup, generateMockupLayers, generateWrapMockup } from './mockup.service';
import { normalizeRole } from '../../../app/middleware/auth.middleware';
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

    // original_price / display_rank / location là field thật; hai nhánh cũ từng mượn tạm
    // rejection_reason / stock_alert_threshold / tags[0] nên vẫn đọc fallback cho dữ liệu cũ.
    const legacyOriginal = product.rejection_reason && !isNaN(Number(product.rejection_reason))
        ? Number(product.rejection_reason)
        : undefined;
    const originalPrice = product.original_price
        ?? legacyOriginal
        ?? (price ? Math.round(price * 1.1) : 0);

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
            rating: shop.average_rating || 5.0,
        } : undefined,
        sellerId: product.shop_id ? product.shop_id.toString() : undefined,
        tags: product.tags || [],
        allowCustomization: Boolean(product.allow_customization),
        customizationType: product.customization_type || 'NONE',
        createdAt: product.created_at ? new Date(product.created_at).toISOString() : new Date().toISOString(),
        updatedAt: product.updated_at ? new Date(product.updated_at).toISOString() : new Date().toISOString(),
    };
}


/** A validation failure carrying every broken rule, surfaced to the client as 400. */
export class ValidationError extends Error {
    errors: string[];
    constructor(errors: string[]) {
        super(errors.join('; '));
        this.name = 'ValidationError';
        this.errors = errors;
    }
}

/** A permission failure (wrong owner / role). Surfaced as 403. */
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
    /** Mã màu hex do seller chọn, hoặc URL mockup ở luồng POD. */
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
    // POD
    isPod: boolean;
    blank?: Blank;
    podVariants?: { sku: string; markup: number; stock: number }[];
    designPlacements?: { design_id: string; print_area_key: string; x: number; y: number; scale: number; rotation: number }[];
}

/** Ai đang thao tác — dùng cho mọi kiểm tra quyền sở hữu. */
export interface ProductActor {
    id: string;
    role: string;
}

/** Chỉ marketplace công khai mới lọc theo cờ này. Seller xem hàng của chính mình thì không. */
const PUBLIC_QUERY = { status: 'PUBLISHED', is_hidden: { $ne: true } } as const;

export class ProductsService {
    /**
     * Central validation for the publish spec. Collects ALL errors before throwing
     * so the client sees every problem at once. Used by both create and update.
     * ponytail: one validator, both call sites route through it — no duplicated rules.
     */
    static async validate(payload: any, opts: { partial?: boolean } = {}): Promise<ValidatedProductData> {
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

        // categoryId must exist AND be active. Seller may only pick, never create.
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

        // Existing tags must all exist in the system. Seller may only pick existing tags here;
        // brand-new tag names arrive via `newTagNames` and become pending proposals (handled in create/update).
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

        // POD mode: seller đè design lên phôi. Ảnh sinh từ mockup (không nhập tay), variant tính từ giá phôi + markup.
        const isPod = payload.blankId !== undefined && payload.blankId !== null && payload.blankId !== '';

        // Images / mockups are mandatory for a non-POD publishable product. POD sinh ảnh từ mockup nên bỏ qua.
        const images: string[] = Array.isArray(payload.images) ? payload.images.filter((i: any) => typeof i === 'string' && i.trim()) : [];
        if (!isPod && (!partial || payload.images !== undefined)) {
            if (images.length === 0) errors.push('at least one image/mockup is required');
        }

        // Variants — Printify-style: each needs a positive price and non-negative stock.
        const usesPrintify = payload.product_type === 'POD_TEMPLATE' || !!payload.printify;
        let variants: VariantInput[] = Array.isArray(payload.variants) ? payload.variants : [];
        if (!isPod && (!partial || payload.variants !== undefined || payload.price !== undefined)) {
            if (variants.length === 0) {
                // Back-compat: a single flat `price` becomes one "Standard" variant.
                if (typeof payload.price === 'number') {
                    variants = [{ price: payload.price, stock: payload.stock ?? 100 }];
                } else {
                    errors.push('at least one variant is required');
                }
            }
            variants.forEach((v, i) => {
                if (typeof v.price !== 'number' || v.price <= 0) errors.push(`variant[${i}].price must be > 0`);
                if (v.stock !== undefined && (typeof v.stock !== 'number' || v.stock < 0)) errors.push(`variant[${i}].stock must be >= 0`);
                // ponytail: real Printify would validate print_provider/blueprint/variant_id against
                // the Printify API here. No integration exists in this repo, so we only require the
                // Printify variant to carry a sku. Upgrade path: call Printify API when wired.
                if (usesPrintify && !v.sku) errors.push(`variant[${i}] from Printify must have a sku`);
            });
        }

        // POD validation: phôi phải tồn tại + active; mỗi variant map tới sku hợp lệ của phôi + markup ≥ 0;
        // mỗi design_placement trỏ design thuộc seller. Ảnh sản phẩm = mockup sinh ở create.
        let blank: Blank | undefined;
        let podVariants: { sku: string; markup: number; stock: number }[] | undefined;
        let designPlacements: any[] | undefined;
        if (isPod) {
            try {
                blank = await BlankClient.getBlank(payload.blankId);
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
                if (!vari) { errors.push(`variant[${i}].sku không thuộc phôi đã chọn`); return; }
                if (seenSku.has(v.sku)) { errors.push(`variant[${i}].sku bị trùng`); return; }
                seenSku.add(v.sku);
                const markup = Number(v.markup ?? 0);
                if (!Number.isFinite(markup) || markup < 0) errors.push(`variant[${i}].markup phải là số >= 0`);
                const stock = Number(v.stock ?? 100);
                if (!Number.isFinite(stock) || stock < 0) errors.push(`variant[${i}].stock phải là số >= 0`);
                podVariants!.push({ sku: v.sku, markup, stock });
            });

            const rawPl = Array.isArray(payload.designPlacements) ? payload.designPlacements : [];
            if (rawPl.length === 0) errors.push('cần ít nhất 1 thiết kế đặt lên phôi (designPlacements)');
            designPlacements = [];
            // Chỉ cache design theo id để check ownership 1 lần.
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
                    // Layer-based: image | text | shape
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
                    // Legacy: 1 ảnh/mặt
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

    /** Generate a unique slug from title: base, then base-2, base-3... on collision. */
    static async uniqueSlug(title: string, excludeId?: string): Promise<string> {
        const base = generateSlug(title);
        let slug = base;
        let n = 1;
        // ponytail: linear probe; fine for expected volume. Upgrade to a counter/suffix
        // strategy only if slug churn ever makes this a hotspot.
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
    }

    /**
     * Turn seller-proposed tag names into tag docs. Existing tag (by slug) is reused;
     * a genuinely new name is created as a 'pending' proposal for admin review.
     * Returns the tag docs to attach, and how many were newly proposed.
     * ponytail: upsert by slug is the whole dedupe story — no separate "requests" collection.
     */
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


    /** Shop mà user sở hữu; tạo mới ở lần đăng sản phẩm đầu tiên. */
    private static async resolveShop(sellerId: string) {
        const ownerId = new mongoose.Types.ObjectId(sellerId);
        let shop = await Shop.findOne({ owner_id: ownerId });
        if (!shop) {
            // Lấy tên thật của seller để shop không mang tên là chuỗi id.
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

    /** Shop.slug là unique — dò hậu tố cho tới khi trống. */
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

    /** Chủ sở hữu = user sở hữu shop chứa sản phẩm. Admin bỏ qua kiểm tra. */
    private static async assertOwnership(mp: any, actor: ProductActor) {
        if (normalizeRole(actor.role) === 'admin') return;
        const shop = await Shop.findById(mp.shop_id).lean();
        if (!shop || shop.owner_id.toString() !== actor.id) {
            throw new ForbiddenError('Bạn chỉ có thể thao tác trên sản phẩm của gian hàng mình');
        }
    }

    /** Ghép điều kiện lọc của FE (search/category/status) lên một query nền cho trước. */
    private static buildQuery(base: any, filter?: ProductFilterQueryDTO): any {
        const query: any = { ...base };

        if (filter?.status && filter.status !== 'ALL') {
            // OUT_OF_STOCK không phải trạng thái lưu trong DB — nó suy ra từ tồn kho.
            query.listing_status = filter.status === 'OUT_OF_STOCK' ? 'ACTIVE' : filter.status;
        }

        if (filter?.category && filter.category.trim() !== ''
            && filter.category !== 'Tất cả danh mục' && filter.category !== 'ALL') {
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

        return query;
    }

    /**
     * Phân trang + map sang DTO. Sắp xếp theo giá/tồn kho phải đi qua aggregate vì hai
     * đại lượng đó nằm ở collection variant, không nằm trên product.
     */
    private static async page(query: any, filter?: ProductFilterQueryDTO): Promise<PaginatedProductsResponseDTO> {
        const total = await MongoProduct.countDocuments(query);
        const page = Math.max(1, Number(filter?.page) || 1);
        const limit = Math.max(1, Number(filter?.limit || filter?.pageSize) || 6);
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const skip = (page - 1) * limit;

        const sort = filter?.sort;
        let docs: any[];
        if (sort === 'price_asc' || sort === 'price_desc' || sort === 'stock_asc' || sort === 'stock_desc') {
            const dir = sort.endsWith('_asc') ? 1 : -1;
            const field = sort.startsWith('price') ? '_minPrice' : '_totalStock';
            docs = await MongoProduct.aggregate([
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
            ]);
        } else {
            const sortOption: any = sort === 'rank_asc'
                ? { display_rank: 1, created_at: -1 }
                : { created_at: -1 };
            docs = await MongoProduct.find(query).sort(sortOption).skip(skip).limit(limit).lean();
        }

        const items = await ProductsService.mapMany(docs);
        return { items, total, page, limit, totalPages };
    }

    /** Nạp variant + shop cho một lô product bằng 2 truy vấn, tránh N+1. */
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

    /** Marketplace công khai — chỉ hàng đã PUBLISHED và chưa bị ẩn. */
    static async getAll(filter?: ProductFilterQueryDTO): Promise<PaginatedProductsResponseDTO> {
        const base: any = { ...PUBLIC_QUERY };

        // Xem gian hàng của một seller cụ thể (vẫn chỉ thấy hàng công khai).
        if (filter?.sellerId && mongoose.Types.ObjectId.isValid(filter.sellerId)) {
            const sellerShop = await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(filter.sellerId) }).lean();
            if (!sellerShop) return { items: [], total: 0, page: 1, limit: Number(filter?.limit || filter?.pageSize) || 6, totalPages: 0 };
            base.shop_id = sellerShop._id;
        } else if (filter?.shopId && mongoose.Types.ObjectId.isValid(filter.shopId)) {
            base.shop_id = new mongoose.Types.ObjectId(filter.shopId);
        }

        return ProductsService.page(ProductsService.buildQuery(base, filter), filter);
    }

    /**
     * Hàng của chính seller đang đăng nhập — kể cả bản chưa PUBLISHED hoặc đã bị admin gỡ,
     * để seller còn thấy và sửa. Thay cho cơ chế cũ dựa vào optionalAuthenticate.
     */
    static async getMine(actor: ProductActor, filter?: ProductFilterQueryDTO): Promise<PaginatedProductsResponseDTO> {
        const limit = Number(filter?.limit || filter?.pageSize) || 6;

        // Admin xem được tất cả; seller chỉ thấy shop của mình.
        const base: any = { is_hidden: { $ne: true } };
        if (normalizeRole(actor.role) !== 'admin') {
            const shop = await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(actor.id) }).lean();
            if (!shop) return { items: [], total: 0, page: 1, limit, totalPages: 0 };
            base.shop_id = shop._id;
        }

        return ProductsService.page(ProductsService.buildQuery(base, filter), filter);
    }

    /**
     * Chi tiết sản phẩm. Mặc định chỉ trả hàng công khai; `includeHidden` dành cho các
     * luồng nội bộ (create/update/moderation) cần đọc lại bản ghi vừa ghi.
     */
    static async getById(id: string, opts: { includeHidden?: boolean } = {}): Promise<ProductItemResponseDTO> {
        if (!mongoose.Types.ObjectId.isValid(id)) throw new Error('Không tìm thấy sản phẩm.');

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
    }

    /** Gợi ý sản phẩm liên quan — chỉ lấy hàng công khai. */
    static async getRelated(id: string, category?: string, limit = 4): Promise<ProductItemResponseDTO[]> {
        if (!mongoose.Types.ObjectId.isValid(id)) return [];
        const self = new mongoose.Types.ObjectId(id);

        const base: any = { ...PUBLIC_QUERY, listing_status: 'ACTIVE', _id: { $ne: self } };
        let docs = await MongoProduct.find(category ? { ...base, categories: category } : base)
            .limit(limit).lean();

        // Không đủ cùng danh mục thì bù bằng hàng công khai khác.
        if (docs.length < limit) {
            const extra = await MongoProduct.find({
                ...base,
                _id: { $nin: [self, ...docs.map(p => p._id)] }
            }).limit(limit - docs.length).lean();
            docs = [...docs, ...extra];
        }

        return ProductsService.mapMany(docs);
    }

    /** Gian hàng nổi bật cho trang chủ — ưu tiên shop có điểm đánh giá cao. */
    static async getFeaturedShops(): Promise<any[]> {
        return Shop.find().sort({ average_rating: -1, listing_count: -1 }).limit(5).lean();
    }

    private static async createStructured(sellerId: string, payload: any): Promise<ProductItemResponseDTO> {
        // Seller → Create → Validate → Publish (no pre-moderation).
        // _sellerId: cho validate check design ownership trong POD.
        const data = await ProductsService.validate({ ...payload, _sellerId: sellerId });
        const shop = await ProductsService.resolveShop(sellerId);
        const slug = await ProductsService.uniqueSlug(data.title);

        // Proposed tag names become pending tags; product still publishes immediately.
        const proposed = await ProductsService.resolveProposedTags(data.newTagNames, sellerId);
        const allTags = [...data.tagDocs, ...proposed.docs];

        // POD: sinh mockup + variant từ phôi. Non-POD: giữ nguyên luồng cũ.
        let images = data.images;
        let variantsToWrite: VariantInput[] = data.variants;
        let podFields: any = {};
        if (data.isPod && data.blank) {
            const built = await ProductsService.buildPodArtifacts(data.blank, data.podVariants!, data.designPlacements!);
            images = built.images;
            variantsToWrite = built.variants;
            podFields = {
                product_type: 'POD_TEMPLATE',
                customization_type: 'ONLINE_MOCKUP',
                blank_id: payload.blankId,
                design_placements: data.designPlacements!.map((p: any) => ({
                    ...p,
                    design_id: p.design_id ? new mongoose.Types.ObjectId(p.design_id) : undefined,
                    layers: (p.layers || []).map((l: any) => l.type === 'image' && l.design_id
                        ? { ...l, design_id: new mongoose.Types.ObjectId(l.design_id) }
                        : l),
                })),
            };
        }

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
            listing_status: 'ACTIVE',       // keep legacy field in sync
            moderation_status: 'APPROVED',  // no pre-moderation
            ...podFields,
        });

        await ProductsService.writeVariants(mp._id, variantsToWrite);
        // Keep tag usage counters accurate.
        if (allTags.length) {
            await Tag.updateMany({ _id: { $in: allTags.map(t => t._id) } }, { $inc: { product_count: 1 } });
        }

        await Shop.updateOne({ _id: shop._id }, { $inc: { listing_count: 1 } });
        return ProductsService.getById(mp._id.toString(), { includeHidden: true });
    }

    /**
     * Danh mục + thẻ cho form phẳng của seller portal.
     *
     * Tách khỏi validate(): validate() là bộ luật của luồng POD/structured nên còn ép
     * description >= 10 ký tự, ảnh và variant — form phẳng không có những ràng buộc đó.
     * Ở đây chỉ kiểm đúng hai thứ form phẳng thật sự gửi lên.
     *
     * `required` = true khi tạo mới: sản phẩm không gắn được vào danh mục admin thì
     * người mua duyệt theo danh mục sẽ không bao giờ thấy nó. Khi sửa thì để false,
     * payload không nhắc tới danh mục/thẻ nghĩa là "giữ nguyên".
     */
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
            // Không phân biệt tạo hay sửa: đã đụng tới thẻ thì phải còn ít nhất 1.
            // `required` chỉ quyết định payload ĐƯỢC PHÉP im lặng hay không — gửi
            // tagIds: [] là chủ động gỡ sạch, và điều đó phá cam kết mọi sản phẩm đều có thẻ.
            if (all.length === 0) errors.push('Vui lòng chọn ít nhất 1 thẻ');
            out.tags = all;
        }

        if (errors.length) throw new ValidationError(errors);
        return out;
    }

    /**
     * Đường tạo nhanh của seller portal: form phẳng (category là tên, giá/tồn/màu nhập tay).
     * Khác với createStructured — vốn dành cho luồng POD chọn phôi + đặt design.
     */
    private static async createSimple(sellerId: string, payload: ProductFormDataDTO): Promise<ProductItemResponseDTO> {
        const title = String(payload.title || '').trim();
        if (!title) throw new ValidationError(['Tên sản phẩm là bắt buộc']);

        const basePrice = Number(payload.price) || 0;
        if (basePrice <= 0) throw new ValidationError(['Giá bán phải lớn hơn 0']);

        const totalStock = Number(payload.stock) || 0;
        if (totalStock < 0) throw new ValidationError(['Tồn kho không được âm']);

        // Bắt buộc khi tạo mới — không cho sản phẩm ra đời mà không thuộc danh mục nào.
        const catalog = await ProductsService.resolveFlatCatalog(payload, sellerId, { required: true });
        const tags = catalog.tags || [];

        const shop = await ProductsService.resolveShop(sellerId);
        const slug = await ProductsService.uniqueSlug(title);

        const images = payload.images && payload.images.length > 0
            ? payload.images
            : (payload.thumbnail ? [payload.thumbnail] : []);

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
        await ProductsService.writeVariants(mp._id, ProductsService.colorsToVariants(payload.colors, baseSku, basePrice, totalStock));
        if (tags.length) {
            await Tag.updateMany({ _id: { $in: tags.map(t => t._id) } }, { $inc: { product_count: 1 } });
        }
        await Shop.updateOne({ _id: shop._id }, { $inc: { listing_count: 1 } });

        logger.info(`Created new product: ${mp._id} (${mp.title})`);
        return ProductsService.getById(mp._id.toString(), { includeHidden: true });
    }

    /**
     * Trải danh sách màu của form seller thành variant, chia đều tồn kho (dư dồn cho màu cuối).
     * Không có màu nào thì tạo một variant mặc định.
     */
    private static colorsToVariants(
        colors: ProductColorVariantDTO[] | undefined,
        baseSku: string,
        basePrice: number,
        totalStock: number
    ): VariantInput[] {
        const baseCost = Math.round(basePrice * 0.7);

        if (!colors || colors.length === 0) {
            return [{
                sku: baseSku,
                color: 'Tự nhiên',
                base_cost: baseCost,
                price: basePrice,
                stock: totalStock,
            }];
        }

        const perColor = Math.max(0, Math.floor(totalStock / colors.length));
        return colors.map((c, i) => ({
            sku: `${baseSku}-${i + 1}`,
            color: c.name,
            mockup_image: c.hex,
            base_cost: baseCost,
            price: basePrice,
            stock: i === colors.length - 1 ? totalStock - perColor * (colors.length - 1) : perColor,
        }));
    }

    /**
     * Hai FE form cùng gọi POST /products với hai payload khác nhau:
     *  - form POD (CreateProductPage) gửi categoryId/blankId/variants/designPlacements
     *  - form seller portal gửi category (tên) + price/stock/colors phẳng
     * Phân nhánh theo payload thay vì bắt một bên phải đổi.
     */
    static async create(sellerId: string, payload: any): Promise<ProductItemResponseDTO> {
        // Dấu hiệu structured phải là thứ CHỈ luồng POD gửi. categoryId từng nằm ở đây,
        // nhưng nay form phẳng cũng gửi categoryId (danh mục admin) — nếu vẫn nhận nó làm
        // dấu hiệu thì form phẳng bị đẩy sang createStructured và mất sạch colors,
        // location, rank, sku, originalPrice, status vốn chỉ createSimple xử lý.
        const isStructured = payload?.blankId !== undefined
            || Array.isArray(payload?.designPlacements)
            || Array.isArray(payload?.variants);
        return isStructured
            ? ProductsService.createStructured(sellerId, payload)
            : ProductsService.createSimple(sellerId, payload as ProductFormDataDTO);
    }

    /**
     * POD: từ phôi + markup + placements → sinh mockup cho mỗi biến thể màu, và variant với
     * base_cost = giá phôi, retail_price = base_cost + markup. Ảnh sản phẩm = các mockup sinh ra.
     * ponytail: 1 mockup / màu (ảnh phôi hiện là default_image dùng chung); nâng cấp ảnh phôi theo màu khi Printer hỗ trợ.
     */
    private static async buildPodArtifacts(
        blank: Blank,
        podVariants: { sku: string; markup: number; stock: number }[],
        placements: any[]
    ): Promise<{ images: string[]; variants: VariantInput[] }> {
        // Gom mọi design_id (kể cả trong layers) để resolve URL.
        const ids = new Set<string>();
        for (const p of placements) {
            if (p.design_id) ids.add(String(p.design_id));
            for (const l of (p.layers || [])) if (l.type === 'image' && l.design_id) ids.add(String(l.design_id));
        }
        const designs = await Design.find({ _id: { $in: [...ids].map(id => new mongoose.Types.ObjectId(id)) } }).lean();
        const designUrl = (id: string) => designs.find(d => d._id.toString() === String(id))?.file_url;

        // 1 mockup / mặt — ghép lên ảnh ĐÚNG mặt (front/back).
        const mockups: string[] = [];
        for (const p of placements) {
            const area = blank.print_areas?.find(a => a.key === p.print_area_key) || null;
            const blankImage = (area && (area as any).image) || blank.default_image;

            if (Array.isArray(p.layers) && p.layers.length) {
                // Layer-based: chuyển sang Layer[] cho mockup engine.
                const layers = p.layers.map((l: any) => l.type === 'image'
                    ? { ...l, designUrl: designUrl(l.design_id) }
                    : l
                ).filter((l: any) => l.type !== 'image' || l.designUrl);
                if (area && (area as any).surface === 'wrap') {
                    // Cốc/bình: trải phẳng dieline → cuộn cong → dán lên ảnh phôi.
                    mockups.push(await generateWrapMockup(blankImage, layers, {
                        x: area.x, y: area.y, width: area.width, height: area.height,
                        template_w: (area as any).template_w || 2475, template_h: (area as any).template_h || 1155,
                        arc: (area as any).arc,
                    }));
                } else {
                    mockups.push(await generateMockupLayers(blankImage, layers));
                }
            } else if (p.design_id) {
                // Legacy: 1 ảnh/mặt.
                const url = designUrl(p.design_id);
                if (!url) continue;
                mockups.push(await generateMockup(blankImage, url, area, { x: p.x, y: p.y, scale: p.scale, rotation: p.rotation }));
            }
        }
        const images = mockups.length ? mockups : [blank.default_image];

        // Variant: base_cost từ phôi, retail = base_cost + markup.
        const variants: VariantInput[] = podVariants.map(pv => {
            const vari = blank.variations.find(v => v.sku === pv.sku)!;
            return {
                sku: pv.sku,
                color: vari.color,
                size: vari.size,
                material: vari.material,
                base_cost: vari.base_cost,
                price: vari.base_cost + pv.markup, // retail
                stock: pv.stock,
            };
        });
        return { images, variants };
    }

    /**
     * Preview mockups (không lưu SP): validate quyền + render mockup cho từng mặt.
     * Dùng cho bước "Xem trước" ở FE — trả về ảnh mockup thật (gồm wrap cốc).
     */
    static async previewMockups(sellerId: string, blankId: string, designPlacements: any[]): Promise<string[]> {
        if (!blankId) throw new ValidationError(['thiếu blankId']);
        const blank = await BlankClient.getBlank(blankId);
        if (!blank) throw new ValidationError(['phôi không tồn tại']);

        // resolve design URLs + check ownership.
        const ids = new Set<string>();
        for (const p of (designPlacements || [])) {
            if (p.design_id) ids.add(String(p.design_id));
            for (const l of (p.layers || [])) if (l.type === 'image' && l.design_id) ids.add(String(l.design_id));
        }
        const designs = await Design.find({ _id: { $in: [...ids].map(id => new mongoose.Types.ObjectId(id)) } }).lean();
        const ownedUrl = (id: string) => {
            const d = designs.find(x => x._id.toString() === String(id));
            if (!d) return undefined;
            if (d.seller_id.toString() !== String(sellerId)) return undefined; // chỉ ảnh của mình
            return d.file_url;
        };

        const out: string[] = [];
        for (const p of (designPlacements || [])) {
            const area = blank.print_areas?.find(a => a.key === p.print_area_key) || null;
            const blankImage = (area && (area as any).image) || blank.default_image;
            if (!Array.isArray(p.layers) || !p.layers.length) continue;
            const layers = p.layers.map((l: any) => l.type === 'image' ? { ...l, designUrl: ownedUrl(l.design_id) } : l)
                .filter((l: any) => l.type !== 'image' || l.designUrl);
            if (!layers.length) continue;
            if (area && (area as any).surface === 'wrap') {
                out.push(await generateWrapMockup(blankImage, layers, {
                    x: area.x, y: area.y, width: area.width, height: area.height,
                    template_w: (area as any).template_w || 2475, template_h: (area as any).template_h || 1155,
                    arc: (area as any).arc,
                }));
            } else {
                out.push(await generateMockupLayers(blankImage, layers));
            }
        }
        return out;
    }

    /**
     * Cập nhật theo payload có cấu trúc (POD / chọn categoryId / tagIds).
     * Validate từng field CÓ MẶT trong payload (partial), quyền sở hữu đã check ở update().
     */
    private static async updateStructured(mp: any, actor: ProductActor, payload: any): Promise<ProductItemResponseDTO> {
        const id = mp._id.toString();

        // Security: ownership/status fields can never be set through a normal update.
        for (const forbidden of ['sellerId', 'shop_id', 'shopId', 'status', 'owner_id']) {
            if (payload[forbidden] !== undefined) {
                throw new ForbiddenError(`Field "${forbidden}" cannot be changed via update`);
            }
        }

        const data = await ProductsService.validate(payload, { partial: true });

        if (payload.title !== undefined) {
            mp.title = data.title;
            mp.slug = await ProductsService.uniqueSlug(data.title, id);
        }
        if (payload.description !== undefined) mp.description = data.description;
        if (payload.images !== undefined) mp.images = data.images;
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
            // adjust product_count deltas
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

    /** Cập nhật theo form phẳng của seller portal. Quyền sở hữu đã check ở update(). */
    private static async updateSimple(mp: any, actor: ProductActor, payload: Partial<ProductFormDataDTO>): Promise<ProductItemResponseDTO> {
        // Sửa thì không bắt buộc: payload không nhắc tới danh mục/thẻ = giữ nguyên.
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
            // product_count phải bù trừ hai chiều, nếu không nó trôi dần khỏi số thật.
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
        // Tên danh mục chỉ dùng khi client cũ không gửi categoryId.
        if (!catalog.category && payload.category !== undefined) mp.categories = [payload.category];
        if (payload.location !== undefined) mp.location = payload.location;
        if (payload.rank !== undefined) mp.display_rank = payload.rank;
        if (payload.originalPrice !== undefined) mp.original_price = payload.originalPrice;
        if (payload.status !== undefined) {
            // Đây là trạng thái BÁN của seller (listing_status), không phải cờ kiểm duyệt
            // `status` — seller không được tự gỡ/khôi phục bài viết của mình bằng đường này.
            mp.listing_status = payload.status === 'OUT_OF_STOCK' ? 'ACTIVE' : payload.status;
        }
        if (payload.images && payload.images.length > 0) {
            mp.images = payload.images;
        } else if (payload.thumbnail) {
            mp.images = [payload.thumbnail];
        }
        await mp.save();

        if (payload.colors && payload.colors.length > 0) {
            // Đổi bộ màu = viết lại toàn bộ variant.
            const existing = await MongoVariant.find({ product_id: mp._id }).lean();
            const baseSku = payload.sku || existing[0]?.sku?.replace(/-\d+$/, '') || `VC-PRD-${mp._id.toString().substring(18).toUpperCase()}`;
            const basePrice = payload.price !== undefined
                ? Number(payload.price)
                : parseFloat(existing[0]?.retail_price?.toString() || '0');
            const totalStock = payload.stock !== undefined
                ? Number(payload.stock)
                : existing.reduce((sum, v) => sum + (Number(v.stock_quantity) || 0), 0);

            await ProductsService.writeVariants(mp._id, ProductsService.colorsToVariants(payload.colors, baseSku, basePrice, totalStock));
        } else {
            const updates: any = {};
            if (payload.price !== undefined) {
                updates.retail_price = mongoose.Types.Decimal128.fromString(Number(payload.price).toString());
                updates.base_cost = mongoose.Types.Decimal128.fromString((Number(payload.price) * 0.7).toFixed(0));
            }
            if (payload.stock !== undefined) updates.stock_quantity = Number(payload.stock);
            if (payload.sku !== undefined) updates.sku = payload.sku;
            if (Object.keys(updates).length > 0) {
                await MongoVariant.updateMany({ product_id: mp._id }, updates);
            }
        }

        logger.info(`Updated product: ${mp._id} (${mp.title})`);
        return ProductsService.getById(mp._id.toString(), { includeHidden: true });
    }

    /** Cùng lý do phân nhánh như create(): hai FE form, hai dạng payload. */
    static async update(id: string, actor: ProductActor, payload: any): Promise<ProductItemResponseDTO> {
        if (!mongoose.Types.ObjectId.isValid(id)) throw new Error('Không tìm thấy sản phẩm cần cập nhật.');
        const mp = await MongoProduct.findById(id);
        if (!mp) throw new Error('Không tìm thấy sản phẩm cần cập nhật.');
        await ProductsService.assertOwnership(mp, actor);

        // Cùng lý do như create(): updateSimple nay tự xử lý categoryId/tagIds.
        const isStructured = payload?.blankId !== undefined
            || Array.isArray(payload?.designPlacements)
            || Array.isArray(payload?.variants);

        return isStructured
            ? ProductsService.updateStructured(mp, actor, payload)
            : ProductsService.updateSimple(mp, actor, payload as Partial<ProductFormDataDTO>);
    }

    /**
     * Xoá mềm. Sản phẩm đã nằm trong đơn hàng / giỏ hàng nên xoá cứng sẽ làm hỏng
     * tham chiếu ở những nơi đó — đánh dấu is_hidden và rút khỏi mọi truy vấn thay vì xoá thật.
     */
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
        await Shop.updateOne({ _id: mp.shop_id }, { $inc: { listing_count: -1 } });

        logger.info(`Soft deleted product: ${id} by ${actor.id}`);
        return { success: true, message: 'Đã xóa sản phẩm thành công.' };
    }

    /** Xoá mềm hàng loạt. Chỉ đụng tới sản phẩm mà actor thực sự sở hữu. */
    static async batchDelete(ids: string[], actor: ProductActor): Promise<{ success: boolean; count: number }> {
        const scoped = await ProductsService.scopeIdsToActor(ids, actor);
        if (scoped.length === 0) return { success: true, count: 0 };

        const result = await MongoProduct.updateMany(
            { _id: { $in: scoped } },
            { $set: { is_hidden: true, status: 'UNPUBLISHED', listing_status: 'INACTIVE' } }
        );
        await MongoVariant.updateMany({ product_id: { $in: scoped } }, { $set: { is_active: false } });

        logger.info(`Batch soft deleted ${result.modifiedCount} products by ${actor.id}`);
        return { success: true, count: result.modifiedCount };
    }

    /** Bật/tắt bán hàng loạt. Chỉ đụng tới sản phẩm mà actor thực sự sở hữu. */
    static async updateStatus(ids: string[], status: ProductStatus, actor: ProductActor): Promise<{ success: boolean; count: number }> {
        const scoped = await ProductsService.scopeIdsToActor(ids, actor);
        if (scoped.length === 0) return { success: true, count: 0 };

        const mongoStatus = status === 'OUT_OF_STOCK' ? 'ACTIVE' : status;
        const result = await MongoProduct.updateMany(
            { _id: { $in: scoped } },
            { $set: { listing_status: mongoStatus } }
        );

        logger.info(`Batch updated listing_status to ${mongoStatus} for ${result.modifiedCount} products by ${actor.id}`);
        return { success: true, count: result.modifiedCount };
    }

    /**
     * Lọc danh sách id xuống còn những sản phẩm actor được phép đụng vào.
     * Không có bước này thì thao tác hàng loạt cho phép seller xoá hàng của shop khác.
     */
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

    /** Admin post-moderation: take a live product off the marketplace. */
    static async unpublish(id: string, reason?: string) {
        const mp = await MongoProduct.findById(id);
        if (!mp) throw new Error('Product not found');
        mp.status = 'UNPUBLISHED';
        mp.listing_status = 'INACTIVE';
        mp.unpublish_reason = reason;
        await mp.save();
        return ProductsService.getById(id, { includeHidden: true });
    }

    /**
     * Liệt kê những chỗ tin đăng chưa đạt chuẩn, KHÔNG ném lỗi.
     * Dùng để báo cho admin biết, chứ không dùng để chặn thao tác.
     */
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

    /**
     * Admin: khôi phục sản phẩm đã gỡ.
     *
     * Khôi phục là phép ĐẢO NGƯỢC thao tác gỡ của chính admin, nên không được
     * chặn: sản phẩm vốn đã ở trên sàn ngay trước đó. Bản cũ chạy validate rồi
     * ném lỗi khi không đạt, mà bộ luật ấy chưa bao giờ được áp dụng lúc tạo —
     * createSimple (form seller portal) đặt thẳng status PUBLISHED và chỉ kiểm
     * tra title/price/stock, không hề gán category_ids. Hệ quả: mọi sản phẩm
     * trong hệ thống đều gỡ được nhưng không khôi phục lại được, nút "Gỡ khỏi
     * sàn" thành cửa một chiều.
     *
     * Vẫn chạy validate, nhưng để BÁO cho admin biết tin đăng còn thiếu gì.
     * Chỗ đúng để chặn là lúc người bán đăng, không phải lúc admin sửa sai.
     */
    static async republish(id: string): Promise<{ product: any; warnings: string[] }> {
        const mp = await MongoProduct.findById(id);
        if (!mp) throw new Error('Product not found');

        const warnings = await ProductsService.listingIssues(mp);

        mp.status = 'PUBLISHED';
        mp.listing_status = 'ACTIVE';
        mp.unpublish_reason = undefined;
        mp.is_hidden = false;
        await mp.save();

        return { product: await ProductsService.getById(id, { includeHidden: true }), warnings };
    }

    /** Danh mục công khai cho form seller — truy vấn thuộc module category. */
    static async listActiveCategories() {
        return categoryService.listActive();
    }

    /** Thẻ công khai cho form seller — truy vấn thuộc module tags. */
    static async listTags() {
        return tagsService.listApproved();
    }
}

export default ProductsService;
