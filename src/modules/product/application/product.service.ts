import mongoose from 'mongoose';
import { Product as MongoProduct } from '../infrastructure/models/product.model';
import { ProductVariant as MongoVariant } from '../infrastructure/models/product-variant.model';
import { Shop } from '../infrastructure/models/shop.model';

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
    description: string;
    sellerId: string;
    price: number;
    category: string;
    variants: ProductVariant[];
    mockups: ProductMockup[];
    createdAt: Date;
    images?: string[];
}

export class ProductsService {
    static async getAll(): Promise<Product[]> {
        const mongoProducts = await MongoProduct.find({ listing_status: 'ACTIVE' });
        const productsList: Product[] = [];

        for (const mp of mongoProducts) {
            const variants = await MongoVariant.find({ product_id: mp._id, is_active: true });
            const pVariants: ProductVariant[] = variants.map(v => ({
                id: v._id.toString(),
                name: [v.color, v.size, v.material].filter(Boolean).join(' - ') || 'Standard',
                price: parseFloat(v.retail_price.toString()),
                stock: v.stock_quantity,
            }));

            const price = pVariants[0]?.price || 0;

            productsList.push({
                id: mp._id.toString(),
                title: mp.title,
                description: mp.description,
                sellerId: mp.shop_id.toString(),
                price: price,
                category: mp.categories?.[0] || 'General',
                variants: pVariants,
                mockups: mp.images.map((img, index) => ({
                    id: `m_${index}`,
                    url: img,
                    description: `Image ${index + 1}`
                })),
                createdAt: mp.created_at,
                images: mp.images
            });
        }
        return productsList;
    }

    static async getById(id: string): Promise<Product> {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new Error('Product not found');
        }
        const mp = await MongoProduct.findById(id);
        if (!mp) throw new Error('Product not found');

        const variants = await MongoVariant.find({ product_id: mp._id, is_active: true });
        const pVariants: ProductVariant[] = variants.map(v => ({
            id: v._id.toString(),
            name: [v.color, v.size, v.material].filter(Boolean).join(' - ') || 'Standard',
            price: parseFloat(v.retail_price.toString()),
            stock: v.stock_quantity,
        }));

        const price = pVariants[0]?.price || 0;

        return {
            id: mp._id.toString(),
            title: mp.title,
            description: mp.description,
            sellerId: mp.shop_id.toString(),
            price: price,
            category: mp.categories?.[0] || 'General',
            variants: pVariants,
            mockups: mp.images.map((img, index) => ({
                id: `m_${index}`,
                url: img,
                description: `Image ${index + 1}`
            })),
            createdAt: mp.created_at,
            images: mp.images
        };
    }

    static async create(sellerId: string, payload: any) {
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

        const shippingProfileId = new mongoose.Types.ObjectId();
        const { title, description, price, category, images } = payload;

        const mp = await MongoProduct.create({
            shop_id: shop._id,
            shipping_profile_id: shippingProfileId,
            title,
            description,
            product_type: 'READY_TO_SHIP',
            allow_customization: false,
            images: images || [],
            categories: category ? [category] : ['General'],
            weight_g: 500,
            dimensions_cm: { length: 10, width: 10, height: 10 },
            moderation_status: 'APPROVED',
            listing_status: 'ACTIVE',
        });

        const v = await MongoVariant.create({
            product_id: mp._id,
            sku: `SKU-${mp._id.toString().substring(18)}`,
            base_cost: mongoose.Types.Decimal128.fromString((price * 0.6 || 0).toString()),
            retail_price: mongoose.Types.Decimal128.fromString((price || 0).toString()),
            stock_quantity: 100,
            is_active: true,
        });

        return {
            id: mp._id.toString(),
            title: mp.title,
            description: mp.description,
            sellerId: mp.shop_id.toString(),
            price: price || 0,
            category: category || 'General',
            variants: [{
                id: v._id.toString(),
                name: 'Standard',
                price: price || 0,
                stock: 100
            }],
            mockups: [],
            createdAt: mp.created_at,
            images: mp.images
        };
    }

    static async update(id: string, sellerId: string, payload: any) {
        const mp = await MongoProduct.findById(id);
        if (!mp) throw new Error('Product not found');

        const { title, description, price, category, images } = payload;

        if (title) mp.title = title;
        if (description) mp.description = description;
        if (category) mp.categories = [category];
        if (images) mp.images = images;

        await mp.save();

        if (price !== undefined) {
            await MongoVariant.updateMany(
                { product_id: mp._id },
                { retail_price: mongoose.Types.Decimal128.fromString(price.toString()) }
            );
        }

        return this.getById(id);
    }

    static async delete(id: string, sellerId: string) {
        const mp = await MongoProduct.findById(id);
        if (!mp) throw new Error('Product not found');

        mp.listing_status = 'INACTIVE';
        await mp.save();
        return { success: true };
    }

    static async getFeaturedShops() {
        return await Shop.find().limit(3);
    }
}
export default ProductsService;
