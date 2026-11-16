// Usage: npx ts-node scripts/drop-legacy-search-fields.ts [--apply]
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const DB_NAME = 'vietcraft';
const LEGACY: Record<string, string[]> = {
    products: ['title_norm', 'title_lc', 'title_prefixes', 'tags_norm', 'categories_norm', 'description_norm',
        'min_price', 'max_price', 'total_stock', 'sold_count'],
    categories: ['name_norm'],
    shops: ['shop_name_norm'],
    search_logs: ['keyword_norm'],
};

async function main() {
    const apply = process.argv.includes('--apply');
    const uri = process.env.MONGO_URI || '';
    console.log(`Host: ${uri.split('@').pop()?.split(/[/?]/)[0]} | DB: ${DB_NAME} | ${apply ? 'APPLY' : 'DRY-RUN'}`);

    await mongoose.connect(uri, { autoIndex: false });
    const db = mongoose.connection.useDb(DB_NAME).db;

    for (const [name, fields] of Object.entries(LEGACY)) {
        const coll = db.collection(name);
        const filter = { $or: fields.map(f => ({ [f]: { $exists: true } })) };
        const docs = await coll.countDocuments(filter);
        const indexes = (await coll.indexes()).filter(i => Object.keys(i.key).some(k => fields.includes(k) || k === '_fts'));
        console.log(`${name}: ${docs} docs, indexes [${indexes.map(i => i.name).join(', ')}]`);
        if (!apply) continue;
        for (const i of indexes) await coll.dropIndex(i.name!);
        const r = await coll.updateMany(filter, { $unset: Object.fromEntries(fields.map(f => [f, ''])) });
        console.log(`  -> unset ${r.modifiedCount} docs, dropped ${indexes.length} indexes`);
    }
    await mongoose.disconnect();
}

main().catch(async err => {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
