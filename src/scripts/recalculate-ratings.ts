import dotenv from 'dotenv';
import mongoose from 'mongoose';

/**
 * Đồng bộ lại average_rating / rating_count lưu sẵn trên products và shops từ bảng reviews
 * (bỏ review bị báo cáo — cùng công thức Review.recalculateRatings).
 *
 * Các trường này lệch khi review được ghi thẳng vào DB (seed, sửa tay) mà không qua ReviewService.
 * Danh sách sản phẩm, thẻ sản phẩm trên trang shop, bộ lọc "từ N sao" và sắp xếp theo điểm đều đọc
 * các trường lưu sẵn này.
 *
 *   npx ts-node src/scripts/recalculate-ratings.ts          # chạy thử: chỉ in ra chỗ lệch
 *   npx ts-node src/scripts/recalculate-ratings.ts --apply  # ghi vào DB
 */

type Stat = { avg: number; n: number };

const round1 = (x: number) => Number(x.toFixed(1));

async function statsBy(field: 'product_id' | 'shop_id'): Promise<Map<string, Stat>> {
    const rows = await mongoose.connection.collection('reviews').aggregate([
        { $match: { is_reported: { $ne: true }, [field]: { $ne: null } } },
        { $group: { _id: `$${field}`, avg: { $avg: '$rating' }, n: { $sum: 1 } } },
    ]).toArray();
    return new Map(rows.map(r => [String(r._id), { avg: round1(r.avg), n: r.n }]));
}

export async function recalculateRatings(apply: boolean) {
    const db = mongoose.connection;
    const [byProduct, byShop] = await Promise.all([statsBy('product_id'), statsBy('shop_id')]);
    const report = { products: { checked: 0, drifted: 0 }, shops: { checked: 0, drifted: 0 }, samples: [] as string[] };

    // Sản phẩm chưa có review: rating_count = 0 (giao diện hiện "Chưa có đánh giá"); average_rating giữ
    // mặc định của schema (5.0) vì mọi nơi đọc đều kiểm rating_count > 0 trước.
    const productOps: any[] = [];
    for await (const p of db.collection('products').find({}, { projection: { title: 1, average_rating: 1, rating_count: 1 } })) {
        report.products.checked++;
        const live = byProduct.get(String(p._id));
        const want = live ? { average_rating: live.avg, rating_count: live.n } : { average_rating: 5.0, rating_count: 0 };
        const drift = (p.rating_count ?? 0) !== want.rating_count || (want.rating_count > 0 && round1(p.average_rating ?? 0) !== want.average_rating);
        if (!drift) continue;
        report.products.drifted++;
        if (report.samples.length < 15) {
            report.samples.push(`SP "${String(p.title).slice(0, 40)}": ${p.average_rating}★/${p.rating_count ?? 0} -> ${want.average_rating}★/${want.rating_count}`);
        }
        productOps.push({ updateOne: { filter: { _id: p._id }, update: { $set: want } } });
    }

    const shopOps: any[] = [];
    for await (const s of db.collection('shops').find({}, { projection: { shop_name: 1, average_rating: 1, rating_count: 1 } })) {
        report.shops.checked++;
        const live = byShop.get(String(s._id));
        const want = live ? { average_rating: live.avg, rating_count: live.n } : { average_rating: 0, rating_count: 0 };
        if ((s.rating_count ?? 0) === want.rating_count && round1(s.average_rating ?? 0) === want.average_rating) continue;
        report.shops.drifted++;
        report.samples.push(`Shop "${s.shop_name}": ${s.average_rating}★/${s.rating_count ?? 0} -> ${want.average_rating}★/${want.rating_count}`);
        shopOps.push({ updateOne: { filter: { _id: s._id }, update: { $set: want } } });
    }

    if (apply) {
        if (productOps.length) await db.collection('products').bulkWrite(productOps, { ordered: false });
        if (shopOps.length) await db.collection('shops').bulkWrite(shopOps, { ordered: false });
    }
    return report;
}

if (require.main === module) {
    dotenv.config();
    const raw = process.env.MONGO_URI;
    if (!raw) throw new Error('MONGO_URI is required.');
    // Cùng cách chọn database với connectMongo() của ứng dụng.
    const uri = raw.includes('mongodb.net') && !raw.includes('/vietcraft?') ? raw.replace('/?', '/vietcraft?') : raw;
    const apply = process.argv.includes('--apply');
    void mongoose.connect(uri, { autoIndex: false })
        .then(() => recalculateRatings(apply))
        .then(r => {
            process.stdout.write(`${apply ? 'ĐÃ GHI' : 'CHẠY THỬ (thêm --apply để ghi)'}\n`);
            process.stdout.write(`Sản phẩm: ${r.products.drifted}/${r.products.checked} lệch | Shop: ${r.shops.drifted}/${r.shops.checked} lệch\n`);
            r.samples.forEach(line => process.stdout.write(`  ${line}\n`));
        })
        .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; })
        .finally(() => mongoose.disconnect());
}
