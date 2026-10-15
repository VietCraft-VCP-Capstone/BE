#!/usr/bin/env node
/**
 * Nạp dữ liệu của một shop mẫu trong `vietcraft-seed` vào gian hàng THẬT của một người
 * bán trên `vietcraft`, để khu Vận hành (sản phẩm, đơn hàng) có gì mà xem khi demo.
 *
 * Vì sao cần: ánh xạ `AI_SHOP_MAP` chỉ làm module AI đọc dữ liệu shop mẫu. Khu Vận hành
 * đọc thẳng database sàn theo shop_id thật, nên account mới vẫn trống trơn.
 *
 * Mọi bản ghi tạo ra đều mang trường `seed_ref` dạng `shp_00017:lst_000123`, nên
 * `--revert` xoá lại ĐÚNG những gì script này tạo, không đụng dữ liệu của người khác.
 *
 *   node scripts/link-seed-shop-to-seller.js --email ai@do.com            # xem trước
 *   node scripts/link-seed-shop-to-seller.js --email ai@do.com --apply    # nạp thật
 *   node scripts/link-seed-shop-to-seller.js --email ai@do.com --revert   # xoá sạch
 *
 * Tuỳ chọn: --seed-shop shp_00017  --products 12  --orders 25  --hidden
 */

const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = name => args.includes(`--${name}`);

const EMAIL = flag('email');
const SEED_SHOP = flag('seed-shop', 'shp_00017');
const N_PRODUCTS = Number(flag('products', 12));
const N_ORDERS = Number(flag('orders', 25));
const APPLY = has('apply');
const REVERT = has('revert');
// Mặc định sản phẩm HIỆN trên sàn, vì khu Vận hành và trang mua hàng phải khớp nhau khi
// demo. `--hidden` đặt DRAFT + is_hidden nếu không muốn người mua thấy.
const HIDDEN = has('hidden');

if (!EMAIL) {
    console.error('Thiếu --email. Ví dụ: node scripts/link-seed-shop-to-seller.js --email a@b.com --apply');
    process.exit(1);
}

const LIVE = 'vietcraft';
const SEED = 'vietcraft-seed';

/** Chuỗi số của dữ liệu mồi (có khi là "57000") sang số nguyên. */
const num = v => {
    const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? Math.round(n) : 0;
};
const dec = v => mongoose.Types.Decimal128.fromString(String(num(v)));

/** Ảnh của dữ liệu mồi thường là đường dẫn không tồn tại; dùng ảnh thật đang có trên sàn. */
const ANH_DU_PHONG = [
    'https://res.cloudinary.com/dncnpjhce/image/upload/v1789720409/vietcraft/products/photo-1521572163474-6864f9cf17ab_bu9d2t.jpg',
    'https://res.cloudinary.com/dncnpjhce/image/upload/v1789720411/vietcraft/products/photo-1503341504253-dff4815485f1_szw5wx.jpg',
    'https://res.cloudinary.com/dncnpjhce/image/upload/v1789720410/vietcraft/products/photo-1562157873-818bc0726f68_bzfgor.jpg',
];

/** Mã danh mục của mart sang tên danh mục sàn đang dùng. */
const DANH_MUC = {
    apparel: 'Áo thun', bottoms: 'Quần dài', drinkware: 'Ly tách', wallart: 'Tranh ảnh',
    bag: 'Phụ kiện', tech: 'Phụ kiện', accessory: 'Phụ kiện', home: 'Nhà cửa',
    stationery: 'Phụ kiện', pet: 'Phụ kiện', sport: 'Áo thun',
};

(async () => {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    const live = mongoose.connection.getClient().db(LIVE);
    const seed = mongoose.connection.getClient().db(SEED);

    const user = await live.collection('users').findOne({ email: EMAIL });
    if (!user) throw new Error(`Không tìm thấy user ${EMAIL} trong ${LIVE}.users`);
    const shop = await live.collection('shops').findOne({ owner_id: user._id });
    if (!shop) throw new Error(`User ${EMAIL} chưa có gian hàng trong ${LIVE}.shops`);

    const marker = new RegExp(`^${SEED_SHOP}:`);
    console.log(`Người bán : ${EMAIL}`);
    console.log(`Gian hàng : ${shop.shop_name} (${shop._id})`);
    console.log(`Shop mẫu  : ${SEED_SHOP}`);
    console.log();

    /* ------------------------------------------------------------ HOÀN NGUYÊN -- */
    if (REVERT) {
        const q = { shop_id: shop._id, seed_ref: marker };
        const pids = (await live.collection('products').find(q, { projection: { _id: 1 } }).toArray()).map(p => p._id);
        const counts = {
            orders: (await live.collection('orders').deleteMany({ shop_id: shop._id, seed_ref: marker })).deletedCount,
            variants: pids.length ? (await live.collection('product_variants').deleteMany({ product_id: { $in: pids } })).deletedCount : 0,
            products: (await live.collection('products').deleteMany(q)).deletedCount,
        };
        console.log('Đã xoá:', JSON.stringify(counts));
        console.log('Chỉ xoá bản ghi có seed_ref, nên dữ liệu người bán tự tạo không bị ảnh hưởng.');
        await mongoose.disconnect();
        return;
    }

    /* ---------------------------------------------------------------- ĐÃ NẠP? -- */
    const daNap = await live.collection('products').countDocuments({ shop_id: shop._id, seed_ref: marker });
    if (daNap > 0) {
        console.log(`Gian hàng này đã có ${daNap} sản phẩm nạp từ ${SEED_SHOP}.`);
        console.log('Chạy --revert trước nếu muốn nạp lại.');
        await mongoose.disconnect();
        return;
    }

    /* ------------------------------------------------------- CHỌN DỮ LIỆU MỒI -- */
    // Chọn listing BÁN ĐƯỢC NHIỀU NHẤT, để đơn hàng nạp kèm có ý nghĩa.
    const listings = await seed.collection('listings').find({ shop_id: SEED_SHOP }).toArray();
    const lids = listings.map(l => l.listing_id);
    const banTheoListing = await seed.collection('order_items').aggregate([
        { $match: { listing_id: { $in: lids } } },
        { $group: { _id: '$listing_id', n: { $sum: '$quantity' } } },
        { $sort: { n: -1 } },
        { $limit: N_PRODUCTS },
    ]).toArray();
    const chon = banTheoListing.map(x => listings.find(l => l.listing_id === x._id)).filter(Boolean);
    if (!chon.length) throw new Error(`Shop mẫu ${SEED_SHOP} không có listing nào bán được`);

    const variants = await seed.collection('listing_variants')
        .find({ listing_id: { $in: chon.map(l => l.listing_id) } }).toArray();

    console.log(`Sẽ nạp ${chon.length} sản phẩm, mỗi sản phẩm tối đa 8 biến thể.`);

    /* ------------------------------------------------------------ DỰNG SẢN PHẨM -- */
    const now = new Date();
    const spDocs = [];
    const bienTheDocs = [];
    const bienTheTheoSp = new Map();

    for (const l of chon) {
        const pid = new mongoose.Types.ObjectId();
        const vs = variants.filter(v => v.listing_id === l.listing_id).slice(0, 8);
        const gia = num(l.base_price_vnd);
        const von = num(l.base_cost_vnd);

        spDocs.push({
            _id: pid,
            shop_id: shop._id,
            shipping_profile_id: new mongoose.Types.ObjectId(),
            title: l.title,
            description: l.description || l.title,
            product_type: 'READY_TO_SHIP',
            allow_customization: false,
            customization_type: 'NONE',
            listing_status: HIDDEN ? 'DRAFT' : 'ACTIVE',
            status: HIDDEN ? 'DRAFT' : 'PUBLISHED',
            images: ANH_DU_PHONG,
            tags: Array.isArray(l.tags) ? l.tags : String(l.tags || '').split(/[|,]/).filter(Boolean),
            categories: [DANH_MUC[l.category_id] || 'Phụ kiện'],
            tag_ids: [],
            category_ids: [],
            weight_g: 200,
            dimensions_cm: { length: 30, width: 25, height: 2 },
            stock_alert_threshold: 5,
            display_rank: 1,
            moderation_status: 'APPROVED',
            is_hidden: HIDDEN,
            average_rating: 0,
            rating_count: 0,
            // Dấu vết để --revert xoá đúng bản ghi này.
            seed_ref: `${SEED_SHOP}:${l.listing_id}`,
            created_at: now,
            updated_at: now,
        });

        const dsBienThe = (vs.length ? vs : [{ size_code: 'FREE', color_code: 'mac-dinh', price_vnd: gia, cost_vnd: von, stock_qty: 50 }])
            .map(v => {
                const vid = new mongoose.Types.ObjectId();
                return {
                    _id: vid,
                    product_id: pid,
                    sku: `${String(pid).slice(-6)}-${v.color_code || 'x'}-${v.size_code || 'F'}`,
                    color: v.color_code || undefined,
                    size: v.size_code || undefined,
                    base_cost: dec(v.cost_vnd || von),
                    retail_price: dec(v.price_vnd || gia),
                    stock_quantity: num(v.stock_qty) || 50,
                    is_active: true,
                    created_at: now,
                    updated_at: now,
                };
            });
        bienTheDocs.push(...dsBienThe);
        bienTheTheoSp.set(String(pid), { listing: l, bienThe: dsBienThe });
    }

    /* --------------------------------------------------------------- DỰNG ĐƠN -- */
    // Đơn của dữ liệu mồi nằm rải rác trong quá khứ. Dồn chúng vào 90 ngày gần nhất để
    // các cửa sổ 7/30/90 ngày của phần phân tích và của khu Vận hành đều có số.
    const buyers = await live.collection('users')
        .find({ role: { $in: ['BUYER', 'buyer'] } }, { projection: { _id: 1, full_name: 1 } })
        .limit(10).toArray();
    if (!buyers.length) throw new Error('Sàn chưa có người mua nào để gán đơn');

    const diaChi = (await live.collection('orders').findOne({ 'shipping_address.province_id': { $exists: true } }))?.shipping_address
        || { recipient_name: 'Khách lẻ', phone: '0900000000', address_detail: 'Đà Nẵng', province_id: '48', district_id: '494', ward_code: '20290' };

    const spIds = [...bienTheTheoSp.keys()];
    const donDocs = [];
    for (let i = 0; i < N_ORDERS; i++) {
        // Rải đều trong 88 ngày gần nhất, giờ trong khoảng 8h đến 22h.
        const ngay = new Date(now.getTime() - Math.floor((i * 88) / N_ORDERS) * 86400000);
        ngay.setHours(8 + (i * 7) % 14, (i * 13) % 60, 0, 0);

        const sp = spIds[i % spIds.length];
        const { listing, bienThe } = bienTheTheoSp.get(sp);
        const v = bienThe[i % bienThe.length];
        const sl = 1 + (i % 3);
        const gia = num(v.retail_price);
        const von = num(v.base_cost);
        const tamTinh = gia * sl;
        const phiVanChuyen = 30000;
        const phiSan = Math.round(tamTinh * 0.05);
        const buyer = buyers[i % buyers.length];

        donDocs.push({
            buyer_id: buyer._id,
            shop_id: shop._id,
            order_code: `VC-SEED-${SEED_SHOP.replace('shp_', '')}-${String(i + 1).padStart(3, '0')}`,
            payment_method: i % 3 === 0 ? 'COD' : 'VNPAY',
            payment_status: 'PAID',
            order_status: 'DELIVERED',
            shipping_address: { ...diaChi, recipient_name: buyer.full_name || diaChi.recipient_name },
            shipping_details: { carrier: 'ghn', tracking_number: '', shipping_fee: dec(phiVanChuyen) },
            items: [{
                product_id: new mongoose.Types.ObjectId(sp),
                variant_id: v._id,
                title: listing.title,
                color: v.color,
                size: v.size,
                quantity: sl,
                base_cost: dec(von),
                retail_price: dec(gia),
                image: ANH_DU_PHONG[0],
            }],
            financial_breakdown: {
                subtotal: dec(tamTinh),
                shipping_fee: dec(phiVanChuyen),
                coupon_discount: dec(0),
                platform_fee: dec(phiSan),
                seller_payout_amount: dec(tamTinh - phiSan),
            },
            status_history: [
                { status: 'ORDERED', changed_at: ngay, note: 'Đơn được tạo' },
                { status: 'DELIVERED', changed_at: new Date(ngay.getTime() + 4 * 86400000), note: 'Đã giao' },
            ],
            // Giờ trong tuần, 0 = 0h Chủ Nhật. Phần phân tích dùng cho biểu đồ giờ vàng.
            order_hour_of_week: ngay.getDay() * 24 + ngay.getHours(),
            seed_ref: `${SEED_SHOP}:order:${i + 1}`,
            created_at: ngay,
            updated_at: ngay,
        });
    }

    /* ------------------------------------------------------------------- GHI -- */
    const tong = {
        products: spDocs.length,
        product_variants: bienTheDocs.length,
        orders: donDocs.length,
        doanh_thu: donDocs.reduce((s, d) => s + num(d.financial_breakdown.subtotal), 0),
    };

    if (!APPLY) {
        console.log('XEM TRƯỚC, chưa ghi gì. Thêm --apply để ghi thật.');
        console.log(JSON.stringify(tong, null, 1));
        console.log();
        console.log('Ví dụ 3 sản phẩm sẽ tạo:');
        spDocs.slice(0, 3).forEach(p => console.log(`  ${p.title.slice(0, 50)} | ${p.categories[0]} | ${p.status}`));
        await mongoose.disconnect();
        return;
    }

    await live.collection('products').insertMany(spDocs);
    await live.collection('product_variants').insertMany(bienTheDocs);
    await live.collection('orders').insertMany(donDocs);

    console.log('Đã nạp:', JSON.stringify(tong, null, 1));
    console.log();
    console.log(`Sản phẩm ${HIDDEN ? 'ĐANG ẨN với người mua (DRAFT)' : 'ĐANG HIỆN trên trang mua hàng (ACTIVE)'}.`);
    console.log('Xoá lại: node scripts/link-seed-shop-to-seller.js --email ' + EMAIL + ' --revert');

    await mongoose.disconnect();
})().catch(e => {
    console.error('LỖI:', e.message);
    process.exit(1);
});
