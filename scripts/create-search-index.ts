// Usage: npx ts-node scripts/create-search-index.ts
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

import { SEARCH_INDEX, SEARCH_INDEX_DEFINITION } from '../src/modules/product/application/atlas-search';

const DB_NAME = 'vietcraft';
const POLL_MS = 5000;
const MAX_POLLS = 60;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const uri = process.env.MONGO_URI || '';
    const host = uri.split('@').pop()?.split(/[/?]/)[0];
    console.log(`Target host: ${host} | DB: ${DB_NAME}`);

    await mongoose.connect(uri);
    const coll = mongoose.connection.useDb(DB_NAME).db.collection('products');

    const existing = await coll.listSearchIndexes(SEARCH_INDEX).toArray();
    if (existing.length === 0) {
        await coll.createSearchIndex({ name: SEARCH_INDEX, definition: SEARCH_INDEX_DEFINITION });
        console.log(`Created "${SEARCH_INDEX}"`);
    } else {
        await coll.updateSearchIndex(SEARCH_INDEX, SEARCH_INDEX_DEFINITION);
        console.log(`Updated "${SEARCH_INDEX}"`);
    }

    for (let i = 0; i < MAX_POLLS; i++) {
        const [idx]: any[] = await coll.listSearchIndexes(SEARCH_INDEX).toArray();
        console.log(`Status: ${idx?.status} | queryable: ${idx?.queryable}`);
        if (idx?.status === 'READY' && idx?.queryable === true) break;
        await sleep(POLL_MS);
    }

    await mongoose.disconnect();
}

main().catch(async err => {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
