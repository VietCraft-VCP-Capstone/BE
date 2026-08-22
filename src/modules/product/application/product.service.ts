import mongoose from 'mongoose';
import { Product as MongoProduct } from '../infrastructure/models/product.model';
import { ProductVariant as MongoVariant } from '../infrastructure/models/product-variant.model';
import { Shop } from '../infrastructure/models/shop.model';
import { Category } from '../../admin/infrastructure/models/category.model';
import { Tag } from '../../admin/infrastructure/models/tag.model';
import { generateSlug } from '../../../shared/utils/slug';
import { BlankClient, Blank } from './blank-client.service';
import { Design } from '../../design/infrastructure/models/design.model';
import { generateMockup, generateMockupLayers, generateWrapMockup } from './mockup.service';

export interface ProductVariant {
    id: string;
    name: string;
    price: number;
    stock: number;
}

export interface ProductMockup {
    id: string;
    url: string;
    description: string;
}

export interface Product {
    id: string;
    title: string;
    slug: string;
    description: string;
    sellerId: string;
    price: number;
    category: string;
    status: string;
    variants: ProductVariant[];
    mockups: ProductMockup[];
    createdAt: Date;
    images?: string[];
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

    private static toDto(mp: any, variants: any[]): Product {
        const pVariants: ProductVariant[] = variants.map(v => ({
            id: v._id.toString(),
            name: [v.color, v.size, v.material].filter(Boolean).join(' - ') || 'Standard',
            price: parseFloat(v.retail_price.toString()),
            stock: v.stock_quantity,
        }));
        return {
            id: mp._id.toString(),
            title: mp.title,
            slug: mp.slug,
            description: mp.description,
            sellerId: mp.shop_id.toString(),
            price: pVariants[0]?.price || 0,
            category: mp.categories?.[0] || 'General',
            status: mp.status,
            variants: pVariants,
            mockups: (mp.images || []).map((img: string, index: number) => ({
                id: `m_${index}`, url: img, description: `Image ${index + 1}`,
            })),
            createdAt: mp.created_at,
            images: mp.images,
        };
    }

    static async getAll(): Promise<Product[]> {
        // Marketplace shows only published products.
        const mongoProducts = await MongoProduct.find({ status: 'PUBLISHED' });
        const productsList: Product[] = [];
        for (const mp of mongoProducts) {
            const variants = await MongoVariant.find({ product_id: mp._id, is_active: true });
            productsList.push(ProductsService.toDto(mp, variants));
        }
        return productsList;
    }

    static async getById(id: string): Promise<Product> {
        if (!mongoose.Types.ObjectId.isValid(id)) throw new Error('Product not found');
        const mp = await MongoProduct.findById(id);
        if (!mp) throw new Error('Product not found');
        const variants = await MongoVariant.find({ product_id: mp._id, is_active: true });
        return ProductsService.toDto(mp, variants);
    }

    /** Resolve the shop that a given user owns, creating one on first product. */
    private static async resolveShop(sellerId: string) {
        let shop = await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(sellerId) });
        if (!shop) {
            shop = await Shop.create({
                owner_id: new mongoose.Types.ObjectId(sellerId),
                shop_name: `Shop của ${sellerId}`,
                slug: `shop-cua-${sellerId}`,
                average_rating: 4.8,
                listing_count: 1,
            });
        }
        return shop;
    }

    private static async writeVariants(productId: mongoose.Types.ObjectId, variants: VariantInput[]) {
        await MongoVariant.deleteMany({ product_id: productId });
        const docs = variants.map((v, i) => ({
            product_id: productId,
            sku: v.sku || `SKU-${productId.toString().slice(-6)}-${i + 1}`,
            color: v.color,
            size: v.size,
            material: v.material,
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

    static async create(sellerId: string, payload: any) {
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

        return ProductsService.getById(mp._id.toString());
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
     * Update. Seller may only touch their own product; admin may touch any.
     * Re-validates every field that is present in the payload (partial validation).
     */
    static async update(id: string, actor: { id: string; role: string }, payload: any) {
        const mp = await MongoProduct.findById(id);
        if (!mp) throw new Error('Product not found');
        await ProductsService.assertOwnership(mp, actor);

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
        return ProductsService.getById(id);
    }

    static async delete(id: string, actor: { id: string; role: string }) {
        const mp = await MongoProduct.findById(id);
        if (!mp) throw new Error('Product not found');
        await ProductsService.assertOwnership(mp, actor);
        // Soft delete: unpublish + deactivate listing.
        mp.status = 'UNPUBLISHED';
        mp.listing_status = 'INACTIVE';
        await mp.save();
        return { success: true };
    }

    /** Admin post-moderation: take a live product off the marketplace. */
    static async unpublish(id: string, reason?: string) {
        const mp = await MongoProduct.findById(id);
        if (!mp) throw new Error('Product not found');
        mp.status = 'UNPUBLISHED';
        mp.listing_status = 'INACTIVE';
        mp.unpublish_reason = reason;
        await mp.save();
        return ProductsService.getById(id);
    }

    /** Admin: restore a previously unpublished product. Re-validates before going live. */
    static async republish(id: string) {
        const mp = await MongoProduct.findById(id);
        if (!mp) throw new Error('Product not found');
        const variants = await MongoVariant.find({ product_id: mp._id });
        await ProductsService.validate({
            title: mp.title,
            description: mp.description,
            categoryId: mp.category_ids?.[0]?.toString(),
            tagIds: (mp.tag_ids || []).map((t: any) => t.toString()),
            images: mp.images,
            variants: variants.map(v => ({ price: parseFloat(v.retail_price.toString()), stock: v.stock_quantity, sku: v.sku })),
            product_type: mp.product_type,
        });
        mp.status = 'PUBLISHED';
        mp.listing_status = 'ACTIVE';
        mp.unpublish_reason = undefined;
        await mp.save();
        return ProductsService.getById(id);
    }

    /** Owner = the user whose shop holds the product. Admin bypasses. */
    private static async assertOwnership(mp: any, actor: { id: string; role: string }) {
        if (String(actor.role).toLowerCase() === 'admin') return;
        const shop = await Shop.findById(mp.shop_id).lean();
        if (!shop || shop.owner_id.toString() !== actor.id) {
            throw new ForbiddenError('You can only modify your own products');
        }
    }

    static async getFeaturedShops() {
        return await Shop.find().limit(3);
    }

    /** Public: active categories a seller may choose from. */
    static async listActiveCategories() {
        return Category.find({ is_active: true }).sort({ sort_order: 1, name: 1 })
            .select('name slug _id').lean();
    }

    /** Public: approved (active) tags a seller may choose from — pending proposals excluded. */
    static async listTags() {
        return Tag.find({ status: { $ne: 'pending' } }).sort({ name: 1 }).select('name slug color _id').lean();
    }
}
export default ProductsService;
