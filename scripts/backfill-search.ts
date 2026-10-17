// Usage: npx ts-node scripts/backfill-search.ts [--dry] [--migrate]
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

import { normalizeVi, nfcLower, buildPrefixes } from '../src/shared/utils/vietnamese-search.util';

const TEXT_INDEX = 'ProductTextSearchIndex';

async function main() {
    const isDryRun = process.argv.includes('--dry') || process.argv.includes('--dry-run');
    const isMigrate = process.argv.includes('--migrate');
    console.log(`Mode: ${isDryRun ? 'DRY-RUN' : 'LIVE'} | Index: ${isMigrate ? 'MIGRATE' : 'SYNC ONLY'}`);

    const rawUri = process.env.MONGO_URI || '';
    const uri = rawUri.includes('mongodb.net') && !rawUri.includes('/vietcraft?') ? rawUri.replace('/?', '/vietcraft?') : rawUri;

    // Keep Mongoose from building the new text index before legacy ones are dropped
    mongoose.set('autoIndex', false);
    await mongoose.connect(uri);

    const db = mongoose.connection.db;
    const prodColl = db.collection('products');
    const variantColl = db.collection('product_variants');
    const shopColl = db.collection('shops');
    const categoryColl = db.collection('categories');

    const existingIndexes = await prodColl.indexes();
    if (isMigrate) {
        for (const idx of existingIndexes) {
            if (!Object.values(idx.key || {}).includes('text') || idx.name === TEXT_INDEX) continue;
            console.log(`${isDryRun ? '[DRY] would drop' : 'Dropping'} legacy text index "${idx.name}"`);
            if (!isDryRun) await prodColl.dropIndex(idx.name);
        }
    }

    if (!isDryRun && !existingIndexes.some(idx => idx.name === TEXT_INDEX)) {
        await prodColl.createIndex(
            { title_norm: 'text', tags_norm: 'text', categories_norm: 'text', description_norm: 'text' },
            {
                name: TEXT_INDEX,
                weights: { title_norm: 10, tags_norm: 5, categories_norm: 3, description_norm: 1 },
                default_language: 'none'
            }
        );
        console.log(`Created "${TEXT_INDEX}"`);
    }

    if (!isDryRun) {
        await shopColl.createIndex({ shop_name_norm: 1 }).catch(() => {});
        await categoryColl.createIndex({ name_norm: 1 }).catch(() => {});
    }

    const shops = await shopColl.find({}).toArray();
    for (const s of shops) {
        const norm = normalizeVi(s.shop_name || '');
        const updateDoc: any = {};
        if (s.shop_name_norm !== norm) updateDoc.shop_name_norm = norm;
        if (!s.status) updateDoc.status = 'ACTIVE';
        if (Object.keys(updateDoc).length > 0 && !isDryRun) await shopColl.updateOne({ _id: s._id }, { $set: updateDoc });
    }

    const categories = await categoryColl.find({}).toArray();
    for (const c of categories) {
        const norm = normalizeVi(c.name || '');
        if (c.name_norm !== norm && !isDryRun) await categoryColl.updateOne({ _id: c._id }, { $set: { name_norm: norm } });
    }
    console.log(`Synced ${shops.length} shops, ${categories.length} categories`);

    const products = await prodColl.find({}).toArray();
    let updatedCount = 0;

    for (const p of products) {
        const titleNorm = normalizeVi(p.title || '');
        const variants = await variantColl.find({ product_id: p._id }).toArray();
        const prices = variants
            .map((v: any) => parseFloat(v.retail_price?.toString() || '0'))
            .filter((pr: number) => !isNaN(pr) && pr > 0);
        const minPrice = prices.length > 0 ? Math.min(...prices) : (p.price || 0);
        const maxPrice = prices.length > 0 ? Math.max(...prices) : (p.price || 0);
        const totalStock = variants.reduce((sum: number, v: any) => sum + (Number(v.stock_quantity) || 0), 0);

        const needsUpdate = p.title_norm !== titleNorm || !p.tags_norm || !p.categories_norm ||
            p.min_price !== minPrice || p.max_price !== maxPrice || p.total_stock !== totalStock;
        if (!needsUpdate) continue;

        updatedCount++;
        console.log(`[UPDATE] ${p._id} "${p.title}" | ${minPrice}-${maxPrice}đ | stock ${totalStock}`);
        if (isDryRun) continue;
        await prodColl.updateOne({ _id: p._id }, {
            $set: {
                title_norm: titleNorm,
                title_lc: nfcLower(p.title || ''),
                title_prefixes: buildPrefixes(titleNorm),
                tags_norm: Array.isArray(p.tags) ? p.tags.map(t => normalizeVi(t)).filter(Boolean) : [],
                categories_norm: Array.isArray(p.categories) ? p.categories.map(c => normalizeVi(c)).filter(Boolean) : [],
                description_norm: normalizeVi(p.description || ''),
                min_price: minPrice,
                max_price: maxPrice,
                total_stock: totalStock,
                sold_count: p.sold_count ?? 0
            }
        });
    }

    const missingNormCount = await prodColl.countDocuments({ title_norm: { $exists: false } });
    console.log(`Products: ${products.length} checked, ${updatedCount} ${isDryRun ? 'need update' : 'updated'}, ${missingNormCount} missing title_norm`);
    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Lỗi khi chạy backfill-search:', err);
    process.exit(1);
});
