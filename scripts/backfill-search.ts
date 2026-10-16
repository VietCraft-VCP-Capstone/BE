/**
 * Maintenance Script: Backfill and Sync Search Fields for VietCraft Products
 * 
 * Usage:
 *   npx ts-node scripts/backfill-search.ts          (Execute updates directly)
 *   npx ts-node scripts/backfill-search.ts --dry    (Dry-run mode, inspect changes without saving)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

import { normalizeVi, nfcLower, buildPrefixes } from '../src/shared/utils/vietnamese-search.util';

async function main() {
    const isDryRun = process.argv.includes('--dry') || process.argv.includes('--dry-run');
    console.log(`\n======================================================`);
    console.log(`[VIETCRAFT SEARCH MAINTENANCE TOOL]`);
    console.log(`Mode: ${isDryRun ? 'DRY-RUN (Simulated, no writes)' : 'LIVE (Applying updates to MongoDB)'}`);
    console.log(`======================================================\n`);

    const rawUri = process.env.MONGO_URI || '';
    const uri = rawUri.includes('mongodb.net') && !rawUri.includes('/vietcraft?') ? rawUri.replace('/?', '/vietcraft?') : rawUri;

    // Disable autoIndex so Mongoose does not attempt to create conflicting text index before legacy ones are dropped
    mongoose.set('autoIndex', false);

    await mongoose.connect(uri);
    console.log('[1/4] Connected to MongoDB database successfully (autoIndex: false).');

    const db = mongoose.connection.db;
    const prodColl = db.collection('products');
    const variantColl = db.collection('product_variants');
    const shopColl = db.collection('shops');
    const categoryColl = db.collection('categories');

    const isMigrate = process.argv.includes('--migrate');
    console.log(`Index Mode: ${isMigrate ? 'MIGRATE (Check & drop legacy indexes)' : 'CRON / SYNC ONLY (Idempotent, no index drops)'}`);

    // [2/4] Index Sanitation & Setup
    console.log('\n[2/4] Checking and ensuring MongoDB Text & Norm Indexes...');
    const existingIndexes = await prodColl.indexes();

    if (isMigrate) {
        console.log('  -> [MIGRATE MODE] Scanning for legacy text indexes...');
        for (const idx of existingIndexes) {
            const isTextIdx = Object.values(idx.key || {}).includes('text');
            if (isTextIdx && idx.name !== 'ProductTextSearchIndex') {
                console.log(`  -> Found legacy text index "${idx.name}". Dropping...`);
                if (!isDryRun) {
                    await prodColl.dropIndex(idx.name);
                    console.log(`  -> Successfully dropped legacy text index "${idx.name}".`);
                } else {
                    console.log(`  -> [DRY-RUN] Would drop index "${idx.name}".`);
                }
            }
        }
    } else {
        console.log('  -> [CRON MODE] Skipping index drops to prevent downtime during text queries.');
    }

    // Ensure our compound text index exists (idempotent: createIndex does not recreate if existing)
    const hasCurrentTextIndex = existingIndexes.some(idx => idx.name === 'ProductTextSearchIndex');
    if (!hasCurrentTextIndex && !isDryRun) {
        console.log('  -> Creating compound text index "ProductTextSearchIndex"...');
        await prodColl.createIndex(
            { title_norm: 'text', tags_norm: 'text', categories_norm: 'text', description_norm: 'text' },
            {
                name: 'ProductTextSearchIndex',
                weights: { title_norm: 10, tags_norm: 5, categories_norm: 3, description_norm: 1 },
                default_language: 'none'
            }
        );
        console.log('  -> "ProductTextSearchIndex" created successfully.');
    }

    // Ensure shop_name_norm and name_norm indexes exist
    if (!isDryRun) {
        await shopColl.createIndex({ shop_name_norm: 1 }).catch(() => {});
        await categoryColl.createIndex({ name_norm: 1 }).catch(() => {});
    }

    // Backfill shops shop_name_norm and default status
    const shops = await shopColl.find({}).toArray();
    for (const s of shops) {
        const norm = normalizeVi(s.shop_name || '');
        const updateDoc: any = {};
        if (s.shop_name_norm !== norm) {
            updateDoc.shop_name_norm = norm;
        }
        if (!s.status) {
            updateDoc.status = 'ACTIVE';
        }
        if (Object.keys(updateDoc).length > 0 && !isDryRun) {
            await shopColl.updateOne({ _id: s._id }, { $set: updateDoc });
        }
    }
    console.log(`  -> Synchronized shop_name_norm and status for ${shops.length} shops.`);

    // Backfill categories name_norm
    const categories = await categoryColl.find({}).toArray();
    for (const c of categories) {
        const norm = normalizeVi(c.name || '');
        if (c.name_norm !== norm && !isDryRun) {
            await categoryColl.updateOne({ _id: c._id }, { $set: { name_norm: norm } });
        }
    }
    console.log(`  -> Synchronized name_norm for ${categories.length} categories.`);

    // [3/4] Scan & Backfill Products
    console.log('\n[3/4] Processing products and synchronizing variants...');
    const products = await prodColl.find({}).toArray();
    console.log(`  -> Found ${products.length} total products in database.`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const p of products) {
        const titleNorm = normalizeVi(p.title || '');
        const titleLc = nfcLower(p.title || '');
        const titlePrefixes = buildPrefixes(titleNorm);
        const tagsNorm = Array.isArray(p.tags) ? p.tags.map(t => normalizeVi(t)).filter(Boolean) : [];
        const categoriesNorm = Array.isArray(p.categories) ? p.categories.map(c => normalizeVi(c)).filter(Boolean) : [];
        const descriptionNorm = normalizeVi(p.description || '');

        // Fetch price range and stock from variants
        const variants = await variantColl.find({ product_id: p._id }).toArray();
        const prices = variants
            .map((v: any) => parseFloat(v.retail_price?.toString() || '0'))
            .filter((pr: number) => !isNaN(pr) && pr > 0);

        const minPrice = prices.length > 0 ? Math.min(...prices) : (p.price || 0);
        const maxPrice = prices.length > 0 ? Math.max(...prices) : (p.price || 0);
        const totalStock = variants.reduce((sum: number, v: any) => sum + (Number(v.stock_quantity) || 0), 0);

        const updateFields: any = {
            title_norm: titleNorm,
            title_lc: titleLc,
            title_prefixes: titlePrefixes,
            tags_norm: tagsNorm,
            categories_norm: categoriesNorm,
            description_norm: descriptionNorm,
            min_price: minPrice,
            max_price: maxPrice,
            total_stock: totalStock,
            sold_count: p.sold_count ?? 0
        };

        const needsUpdate =
            p.title_norm !== titleNorm ||
            !p.tags_norm ||
            !p.categories_norm ||
            p.min_price !== minPrice ||
            p.max_price !== maxPrice ||
            p.total_stock !== totalStock;

        if (needsUpdate) {
            console.log(`  [UPDATE] ID: ${p._id} | Title: "${p.title}" | Min: ${minPrice}đ | Max: ${maxPrice}đ | Stock: ${totalStock}`);
            if (!isDryRun) {
                await prodColl.updateOne({ _id: p._id }, { $set: updateFields });
            }
            updatedCount++;
        } else {
            skippedCount++;
        }
    }

    // [4/4] Summary
    console.log(`\n[4/4] Execution Summary:`);
    console.log(`  - Total products checked: ${products.length}`);
    console.log(`  - Products ${isDryRun ? 'requiring update' : 'updated'}: ${updatedCount}`);
    console.log(`  - Products up-to-date: ${skippedCount}`);

    // Verify missing check
    const missingNormCount = await prodColl.countDocuments({ title_norm: { $exists: false } });
    console.log(`  - Products with missing title_norm: ${missingNormCount}`);

    await mongoose.disconnect();
    console.log(`\nMaintenance operation finished successfully.\n`);
}

main().catch(err => {
    console.error('Lỗi khi chạy backfill-search:', err);
    process.exit(1);
});
