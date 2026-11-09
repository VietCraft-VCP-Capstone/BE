import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { ReturnRequest, RETURN_REQUEST_ACTIVE_STATUSES } from '../modules/order/infrastructure/models/return-request.model';

/** Add the expanded reservation index; keep the old subset index and all existing documents. */
export async function migrateReturnActiveIndex(): Promise<void> {
    const conflicts = await ReturnRequest.aggregate([
        { $match: { status: { $in: [...RETURN_REQUEST_ACTIVE_STATUSES] } } },
        { $group: { _id: '$order_item_id', requests: { $push: '$_id' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 20 },
    ]);
    if (conflicts.length) throw new Error(`Resolve existing active return conflicts before migration: ${JSON.stringify(conflicts)}`);
    await ReturnRequest.collection.createIndex({ order_item_id: 1 }, {
        unique: true, name: 'uniq_active_return_request_v3_per_item_v2',
        partialFilterExpression: { status: { $in: [...RETURN_REQUEST_ACTIVE_STATUSES] } },
    });
}

if (require.main === module) {
    dotenv.config();
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI is required.');
    void mongoose.connect(uri, { autoIndex: false }).then(migrateReturnActiveIndex)
        .then(() => { process.stdout.write('Return reservation index migrated.\n'); })
        .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; })
        .finally(() => mongoose.disconnect());
}
