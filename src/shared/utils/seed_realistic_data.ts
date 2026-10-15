import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../../modules/user/infrastructure/models/user.model';
import { Shop } from '../../modules/product/infrastructure/models/shop.model';
import { Product } from '../../modules/product/infrastructure/models/product.model';
import { ProductVariant } from '../../modules/product/infrastructure/models/product-variant.model';
import { ShopFollower } from '../../modules/product/infrastructure/models/shop-follower.model';
import { Order } from '../../modules/order/infrastructure/models/order.model';
import { Review } from '../../modules/order/infrastructure/models/review.model';
import { Coupon } from '../../modules/promotion/infrastructure/models/coupon.model';
import { logger } from './logger';
import { config } from '../../app/config';

const SEED_PASSWORD = 'Seed@12345';

export async function seedRealisticData() {
    logger.info('=== BẮT ĐẦU NẠP DỮ LIỆU SEED THỰC TẾ VIETCRAFT ===');

    const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);

    // 1. Tạo Coupons nếu chưa có
    const couponCount = await Coupon.countDocuments();
    if (couponCount === 0) {
        logger.info('Tạo mã ưu đãi mẫu...');
        await Coupon.create([
            { code: 'VCP50K', discount_type: 'FIXED_AMOUNT', discount_value: mongoose.Types.Decimal128.fromString('50000'), min_order_value: mongoose.Types.Decimal128.fromString('200000'), start_date: new Date(), end_date: new Date(Date.now() + 60 * 86400000) },
            { code: 'VCPFREE', discount_type: 'FIXED_AMOUNT', discount_value: mongoose.Types.Decimal128.fromString('30000'), min_order_value: mongoose.Types.Decimal128.fromString('0'), start_date: new Date(), end_date: new Date(Date.now() + 60 * 86400000) },
            { code: 'VCP100K', discount_type: 'FIXED_AMOUNT', discount_value: mongoose.Types.Decimal128.fromString('100000'), min_order_value: mongoose.Types.Decimal128.fromString('1000000'), start_date: new Date(), end_date: new Date(Date.now() + 60 * 86400000) },
            { code: 'VCP10', discount_type: 'PERCENTAGE', discount_value: mongoose.Types.Decimal128.fromString('10'), min_order_value: mongoose.Types.Decimal128.fromString('0'), start_date: new Date(), end_date: new Date(Date.now() + 60 * 86400000) },
        ]);
    }

    // 2. Tạo 2 Seller & Shop hoàn chỉnh
    logger.info('Tạo 2 Shop thủ công mỹ nghệ hoàn chỉnh...');

    // Shop 1: Gốm Mộc Studio
    let seller1 = await User.findOne({ email: 'gom.moc@vietcraft.local' });
    if (!seller1) {
        seller1 = await User.create({
            email: 'gom.moc@vietcraft.local',
            password_hash: passwordHash,
            full_name: 'Nghệ nhân Trần Đình Mộc',
            role: 'SELLER',
            avatar: 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?auto=format&fit=crop&q=80&w=200',
            phone: '0912345678'
        });
    }

    let shop1 = await Shop.findOne({ $or: [{ slug: 'gom-moc-studio' }, { owner_id: seller1._id }] });
    if (!shop1) {
        shop1 = await Shop.create({
            owner_id: seller1._id,
            shop_name: 'Gốm Mộc Studio',
            slug: 'gom-moc-studio',
            logo: 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?auto=format&fit=crop&q=80&w=200',
            banner: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&q=80&w=1200',
            description: 'Làng gốm Bát Tràng, Hà Nội. Tinh hoa gốm thủ công tráng men tự nhiên, nung củi truyền thống từ năm 1985.',
            average_rating: 4.9,
            rating_count: 45,
            listing_count: 4
        });
    } else {
        shop1.owner_id = seller1._id;
        shop1.shop_name = 'Gốm Mộc Studio';
        shop1.slug = 'gom-moc-studio';
        shop1.banner = 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&q=80&w=1200';
        shop1.logo = 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?auto=format&fit=crop&q=80&w=200';
        shop1.description = 'Làng gốm Bát Tràng, Hà Nội. Tinh hoa gốm thủ công tráng men tự nhiên, nung củi truyền thống từ năm 1985.';
        await shop1.save();
    }

    // Shop 2: Xưởng Da Thủ Công
    let seller2 = await User.findOne({ email: 'xuong.da@vietcraft.local' });
    if (!seller2) {
        seller2 = await User.create({
            email: 'xuong.da@vietcraft.local',
            password_hash: passwordHash,
            full_name: 'Xưởng Da Vintage Sài Gòn',
            role: 'SELLER',
            avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
            phone: '0987654321'
        });
    }

    let shop2 = await Shop.findOne({ $or: [{ slug: 'xuong-da-thu-cong' }, { owner_id: seller2._id }] });
    if (!shop2) {
        shop2 = await Shop.create({
            owner_id: seller2._id,
            shop_name: 'Xưởng Da Thủ Công',
            slug: 'xuong-da-thu-cong',
            logo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
            banner: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=1200',
            description: 'Sài Gòn Vintage Leather. Đồ da mộc Veg-tan may tay thủ công 100% từng đường kim mũi chỉ, bảo hành trọn đời đường may.',
            average_rating: 4.8,
            rating_count: 38,
            listing_count: 3
        });
    } else {
        shop2.owner_id = seller2._id;
        shop2.shop_name = 'Xưởng Da Thủ Công';
        shop2.slug = 'xuong-da-thu-cong';
        shop2.banner = 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=1200';
        shop2.logo = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200';
        shop2.description = 'Sài Gòn Vintage Leather. Đồ da mộc Veg-tan may tay thủ công 100% từng đường kim mũi chỉ, bảo hành trọn đời đường may.';
        await shop2.save();
    }

    // 3. Tạo tài khoản Buyer Test + Các Buyer đánh giá
    logger.info('Tạo tài khoản Buyer test và danh sách khách hàng...');
    let buyerTest = await User.findOne({ email: 'buyer.test@vietcraft.local' });
    if (!buyerTest) {
        buyerTest = await User.create({
            email: 'buyer.test@vietcraft.local',
            password_hash: passwordHash,
            full_name: 'Nguyễn Văn Test',
            role: 'BUYER',
            phone: '0901234567',
            avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200',
            addresses: [{
                recipient_name: 'Nguyễn Văn Test',
                phone: '0901234567',
                address_detail: 'Số 12 Ngõ 45 Đường Láng, Phường Láng Thượng',
                province_id: '01',
                district_id: '006',
                ward_code: '00205',
                is_default: true
            }]
        });
    }

    const otherBuyersData = [
        { email: 'ngocmai@vietcraft.local', name: 'Trần Ngọc Mai', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=150' },
        { email: 'hoanglong@vietcraft.local', name: 'Nguyễn Hoàng Long', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150' },
        { email: 'phuonganh@vietcraft.local', name: 'Lê Phương Anh', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150' },
        { email: 'quocbao@vietcraft.local', name: 'Phạm Quốc Bảo', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=150' },
        { email: 'thuyduong@vietcraft.local', name: 'Vũ Thùy Dương', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=150' }
    ];

    const seededBuyers: any[] = [buyerTest];
    for (const ob of otherBuyersData) {
        let u = await User.findOne({ email: ob.email });
        if (!u) {
            u = await User.create({
                email: ob.email,
                password_hash: passwordHash,
                full_name: ob.name,
                role: 'BUYER',
                avatar: ob.avatar,
                phone: '0912000' + Math.floor(Math.random() * 900 + 100)
            });
        }
        seededBuyers.push(u);
    }

    // 4. Khởi tạo người theo dõi cho Shop
    const allBuyerIds = seededBuyers.map(b => b._id);
    await ShopFollower.findOneAndUpdate(
        { shop_id: shop1._id },
        { $addToSet: { buyer_ids: { $each: allBuyerIds } } },
        { upsert: true }
    );
    await ShopFollower.findOneAndUpdate(
        { shop_id: shop2._id },
        { $addToSet: { buyer_ids: { $each: allBuyerIds.slice(0, 4) } } },
        { upsert: true }
    );

    // 5. Tạo 7 Sản phẩm Thủ công mỹ nghệ tinh tế (Artisan Products)
    logger.info('Tạo danh sách 7 sản phẩm Artisan thủ công đặc sắc...');
    const spId = new mongoose.Types.ObjectId();

    const productsSeed = [
        {
            key: 'sp_ly_gom',
            shop_id: shop1._id,
            title: 'Bộ Ly Gốm Mộc Men Lam Bát Tràng (Set 2 Chiếc)',
            slug: 'seed-bo-ly-gom-moc-men-lam',
            description: 'Bộ 2 ly gốm thủ công được chế tác bởi nghệ nhân Bát Tràng. Lớp men lam tro tự nhiên nung củi ở nhiệt độ 1300°C tạo nên sắc xanh sâu thẳm độc bản. Giữ nhiệt tốt, không bám ố chè, an toàn tuyệt đối cho sức khỏe.',
            product_type: 'READY_TO_SHIP',
            allow_customization: true,
            customization_type: 'DIRECT_CHAT',
            categories: ['Gốm sứ & Mỹ nghệ', 'Phụ kiện & Quà tặng'],
            tags: ['Hà Nội', 'Gốm sứ', 'Bát Tràng', 'Thủ công', 'Quà tặng'],
            location: 'Bát Tràng, Hà Nội',
            images: [
                'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&q=80&w=800',
                'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&q=80&w=800',
                'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?auto=format&fit=crop&q=80&w=800'
            ],
            weight_g: 650,
            dimensions_cm: { length: 18, width: 10, height: 10 },
            display_rank: 1,
            original_price: 230000,
            variants: [
                { sku: 'VC-GOM-LY-LAM', name: 'Men Lam Cổ Điển', color: 'Xanh Lam', material: 'Gốm Bát Tràng', price: 195000, stock: 45, mockup: '#1D4ED8' },
                { sku: 'VC-GOM-LY-RAN', name: 'Men Rạn Trắng Cổ', color: 'Trắng Ngà', material: 'Gốm Bát Tràng', price: 210000, stock: 30, mockup: '#F9FAFB' },
                { sku: 'VC-GOM-LY-MOC', name: 'Men Tro Mộc Mạc', color: 'Nâu Đất', material: 'Gốm Bát Tràng', price: 195000, stock: 25, mockup: '#5C4033' }
            ]
        },
        {
            key: 'sp_binh_hoa',
            shop_id: shop1._id,
            title: 'Bình Hoa Gốm Điêu Khắc Khía Nổi Wabi-Sabi',
            slug: 'seed-binh-hoa-gom-khia-noi-wabi-sabi',
            description: 'Bình hoa gốm vuốt tay thủ công phong cách Wabi-sabi mộc mạc. Bề mặt bình được khía rãnh nổi tinh tế, tráng men mờ tạo cảm giác tĩnh tại và trang nhã cho không gian phòng khách hoặc bàn trà.',
            product_type: 'READY_TO_SHIP',
            allow_customization: false,
            customization_type: 'NONE',
            categories: ['Gốm sứ & Mỹ nghệ', 'Phụ kiện & Quà tặng'],
            tags: ['Hà Nội', 'Gốm sứ', 'Bình hoa', 'Trang trí', 'Wabi-Sabi'],
            location: 'Bát Tràng, Hà Nội',
            images: [
                'https://images.unsplash.com/photo-1581783342308-f792dbdd27c5?auto=format&fit=crop&q=80&w=800',
                'https://images.unsplash.com/photo-1612196808214-b8e1d6145a8c?auto=format&fit=crop&q=80&w=800'
            ],
            weight_g: 1100,
            dimensions_cm: { length: 15, width: 15, height: 25 },
            display_rank: 2,
            original_price: 420000,
            variants: [
                { sku: 'VC-GOM-BH-NAU', name: 'Nâu Đất Nung Thô', color: 'Nâu Đất', material: 'Đất sét đỏ', price: 350000, stock: 20, mockup: '#5C4033' },
                { sku: 'VC-GOM-BH-XAM', name: 'Xám Tro Mộc Mạc', color: 'Xám Tro', material: 'Gốm nung củi', price: 370000, stock: 15, mockup: '#9CA3AF' }
            ]
        },
        {
            key: 'sp_vi_da',
            shop_id: shop2._id,
            title: 'Ví Da Nam Dáng Ngang Da Sáp Ngựa Điên (Crazy Horse)',
            slug: 'seed-vi-da-nam-dang-ngang-crazy-horse',
            description: 'Ví da nam chế tác từ da bò sáp Crazy Horse nhập khẩu nguyên tấm. May tay hoàn toàn bằng chỉ sáp chịu lực 0.8mm. Đặc tính da sáp càng dùng càng bóng đẹp và đậm chất bụi bặm phong trần.',
            product_type: 'READY_TO_SHIP',
            allow_customization: true,
            customization_type: 'DIRECT_CHAT',
            categories: ['Phụ kiện & Quà tặng'],
            tags: ['TP.HCM', 'Đồ da', 'Ví da', 'Thủ công', 'Vintage'],
            location: 'Quận 1, TP.HCM',
            images: [
                'https://images.unsplash.com/photo-1627123424574-724758594e93?auto=format&fit=crop&q=80&w=800',
                'https://images.unsplash.com/photo-1554412933-514a83d2f3c8?auto=format&fit=crop&q=80&w=800'
            ],
            weight_g: 150,
            dimensions_cm: { length: 12, width: 9, height: 2 },
            display_rank: 3,
            original_price: 450000,
            variants: [
                { sku: 'VC-DA-VI-CAPHE', name: 'Nâu Cà Phê Cháy', color: 'Nâu Cà Phê', material: 'Da bò Crazy Horse', price: 380000, stock: 50, mockup: '#3D2817' },
                { sku: 'VC-DA-VI-VANG', name: 'Nâu Bò Sáp Vintage', color: 'Nâu Bò', material: 'Da bò Crazy Horse', price: 380000, stock: 40, mockup: '#A0522D' },
                { sku: 'VC-DA-VI-DEN', name: 'Đen Khói Cổ Điển', color: 'Đen Khói', material: 'Da bò Veg-tan', price: 395000, stock: 25, mockup: '#1C1C1C' }
            ]
        },
        {
            key: 'sp_so_tay',
            shop_id: shop2._id,
            title: 'Sổ Tay Bìa Da Bò Mộc Khâu Tay Giấy Kraft Vintage',
            slug: 'seed-so-tay-bia-da-bo-moc-vintage',
            description: 'Sổ tay bìa da bò thật dập vân mộc tự nhiên. Ruột giấy Kraft 100gsm dày dặn, viết êm không nhòe mực. Dây gài da cùng hạt gỗ mộc phong cách cổ điển, thích hợp làm quà tặng ý nghĩa.',
            product_type: 'READY_TO_SHIP',
            allow_customization: true,
            customization_type: 'ONLINE_MOCKUP',
            categories: ['Phụ kiện & Quà tặng'],
            tags: ['TP.HCM', 'Sổ tay', 'Đồ da', 'Giấy Kraft', 'Quà tặng'],
            location: 'Quận 1, TP.HCM',
            images: [
                'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=800',
                'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=800'
            ],
            weight_g: 350,
            dimensions_cm: { length: 21, width: 15, height: 3 },
            display_rank: 4,
            original_price: 310000,
            variants: [
                { sku: 'VC-DA-SO-A5', name: 'Khổ A5 (Nâu Rêu)', color: 'Nâu Rêu', size: 'A5', material: 'Da bò sáp', price: 260000, stock: 60, mockup: '#4B5320' },
                { sku: 'VC-DA-SO-A6', name: 'Khổ A6 Nhỏ Gọn (Nâu Da Bò)', color: 'Nâu Bò', size: 'A6', material: 'Da bò sáp', price: 210000, stock: 45, mockup: '#8B4513' }
            ]
        },
        {
            key: 'sp_that_lung',
            shop_id: shop2._id,
            title: 'Dây Lưng Da Bò Ý Nguyên Tấm Khóa Đồng Đúc',
            slug: 'seed-that-lung-da-bo-y-khoa-dong-duc',
            description: 'Thắt lưng da nam nguyên tấm dập từ da bò Ý dày dặn 4mm. Mặt khóa bằng đồng thau đúc nguyên khối chống gỉ sét. Đường viền được đánh bóng bằng sáp ong tự nhiên tinh xảo.',
            product_type: 'READY_TO_SHIP',
            allow_customization: false,
            customization_type: 'NONE',
            categories: ['Phụ kiện & Quà tặng'],
            tags: ['TP.HCM', 'Thắt lưng', 'Đồ da', 'Đồng đúc'],
            location: 'Quận 1, TP.HCM',
            images: [
                'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=800',
                'https://images.unsplash.com/photo-1624222247344-550fb60583dc?auto=format&fit=crop&w=800'
            ],
            weight_g: 280,
            dimensions_cm: { length: 120, width: 3.8, height: 0.4 },
            display_rank: 5,
            original_price: 580000,
            variants: [
                { sku: 'VC-DA-TL-NAU', name: 'Nâu Hạt Dẻ (Bản 3.8cm)', color: 'Nâu Hạt Dẻ', size: '120cm', material: 'Da bò Ý 4mm', price: 490000, stock: 35, mockup: '#5C4033' },
                { sku: 'VC-DA-TL-DEN', name: 'Đen Tuyền Lịch Lãm', color: 'Đen Tuyền', size: '120cm', material: 'Da bò Ý 4mm', price: 490000, stock: 30, mockup: '#1C1C1C' }
            ]
        },
        {
            key: 'sp_tote_canvas',
            shop_id: shop1._id,
            title: 'Túi Tote Canvas Dệt Tay Thêu Họa Tiết Chim Hạc',
            slug: 'seed-tui-tote-canvas-theu-hac',
            description: 'Túi tote vải bố canvas mộc dệt sợi tự nhiên, thêu tay họa tiết chim Hạc truyền thống bằng chỉ tơ tằm. Có ngăn phụ có khóa kéo bên trong, quai đeo đệm êm ái tiện dụng.',
            product_type: 'POD_TEMPLATE',
            allow_customization: true,
            customization_type: 'ONLINE_MOCKUP',
            categories: ['Túi Tote & Canvas', 'Phụ kiện & Quà tặng'],
            tags: ['Hà Nội', 'Canvas', 'Túi tote', 'Thêu tay', 'Eco-friendly'],
            location: 'Hà Nội',
            images: [
                'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=800&q=80',
                'https://images.unsplash.com/photo-1622560480605-d83c853bc5c3?auto=format&fit=crop&w=800'
            ],
            weight_g: 220,
            dimensions_cm: { length: 38, width: 35, height: 8 },
            display_rank: 6,
            original_price: 210000,
            variants: [
                { sku: 'VC-TOTE-TRANG', name: 'Trắng Ngà Tự Nhiên', color: 'Trắng Ngà', material: 'Canvas 12oz', price: 175000, stock: 70, mockup: '#F9FAFB' },
                { sku: 'VC-TOTE-CHAM', name: 'Xanh Chàm Nhuộm Mộc', color: 'Xanh Chàm', material: 'Canvas 12oz', price: 185000, stock: 40, mockup: '#1E3A8A' }
            ]
        },
        {
            key: 'sp_khay_tra',
            shop_id: shop1._id,
            title: 'Khay Trà Gỗ Xà Cừ Khắc Họa Tiết Trống Đồng',
            slug: 'seed-khay-tra-go-xa-cu-trong-dong',
            description: 'Khay trà chế tác từ gỗ xà cừ nguyên khối, chạm khắc tinh xảo họa tiết Trống Đồng Đông Sơn. Bề mặt lau dầu thực vật lau bóng chống nước, mang đậm hồn cốt văn hóa Việt.',
            product_type: 'READY_TO_SHIP',
            allow_customization: false,
            customization_type: 'NONE',
            categories: ['Gốm sứ & Mỹ nghệ', 'Phụ kiện & Quà tặng'],
            tags: ['Hà Nội', 'Đồ gỗ', 'Trà đạo', 'Trống đồng'],
            location: 'Hà Nội',
            images: [
                'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&q=80&w=800',
                'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&q=80&w=800'
            ],
            weight_g: 850,
            dimensions_cm: { length: 32, width: 22, height: 3 },
            display_rank: 7,
            original_price: 360000,
            variants: [
                { sku: 'VC-GO-KHAY-OVAL', name: 'Dáng Oval 32x22cm', color: 'Nâu Cánh Gián', material: 'Gỗ xà cừ', price: 299000, stock: 25, mockup: '#6B4226' }
            ]
        }
    ];

    const createdProductMap: Record<string, any> = {};
    const createdVariantsMap: Record<string, any[]> = {};

    for (const p of productsSeed) {
        let doc = await Product.findOne({ slug: p.slug });
        if (!doc) {
            doc = await Product.create({
                shop_id: p.shop_id,
                shipping_profile_id: spId,
                title: p.title,
                slug: p.slug,
                description: p.description,
                product_type: p.product_type,
                allow_customization: p.allow_customization,
                customization_type: p.customization_type,
                images: p.images,
                categories: p.categories,
                tags: p.tags,
                location: p.location,
                weight_g: p.weight_g,
                dimensions_cm: p.dimensions_cm,
                display_rank: p.display_rank,
                original_price: p.original_price,
                listing_status: 'ACTIVE',
                status: 'PUBLISHED',
                moderation_status: 'APPROVED',
                average_rating: 5.0,
                rating_count: 0
            });
        } else {
            doc.status = 'PUBLISHED';
            doc.listing_status = 'ACTIVE';
            doc.images = p.images;
            doc.title = p.title;
            doc.description = p.description;
            await doc.save();
        }

        createdProductMap[p.key] = doc;

        // Tạo variants
        const varDocs: any[] = [];
        for (const v of p.variants as any[]) {
            let vDoc = await ProductVariant.findOne({ product_id: doc._id, sku: v.sku });
            if (!vDoc) {
                vDoc = await ProductVariant.create({
                    product_id: doc._id,
                    sku: v.sku,
                    color: v.color,
                    size: v.size,
                    material: v.material,
                    base_cost: mongoose.Types.Decimal128.fromString((v.price * 0.6).toFixed(0)),
                    retail_price: mongoose.Types.Decimal128.fromString(v.price.toString()),
                    stock_quantity: v.stock,
                    mockup_image: v.mockup,
                    is_active: true
                });
            }
            varDocs.push(vDoc);
        }
        createdVariantsMap[p.key] = varDocs;
    }

    // Cập nhật số sản phẩm cho Shop
    shop1.listing_count = await Product.countDocuments({ shop_id: shop1._id, status: 'PUBLISHED' });
    await shop1.save();
    shop2.listing_count = await Product.countDocuments({ shop_id: shop2._id, status: 'PUBLISHED' });
    await shop2.save();

    // 6. Tạo 2 Đơn hàng DELIVERED cho Buyer Test (Sẵn sàng cho flow "Viết Đánh Giá")
    logger.info('Tạo 2 đơn hàng DELIVERED cho tài khoản Buyer Test...');
    const deliveredOrder1 = await Order.findOneAndUpdate(
        { order_code: 'VC-DELIVERED-001' },
        {
            buyer_id: buyerTest._id,
            shop_id: shop1._id,
            order_code: 'VC-DELIVERED-001',
            payment_method: 'COD',
            payment_status: 'PAID',
            order_status: 'DELIVERED',
            shipping_address: {
                recipient_name: buyerTest.full_name,
                phone: buyerTest.phone || '0901234567',
                address_detail: 'Số 12 Ngõ 45 Đường Láng, Phường Láng Thượng',
                province_id: '01',
                district_id: '006',
                ward_code: '00205'
            },
            shipping_details: {
                carrier: 'ghn',
                tracking_number: 'GHN-VC-8839210',
                shipping_fee: mongoose.Types.Decimal128.fromString('30000')
            },
            items: [
                {
                    product_id: createdProductMap['sp_ly_gom']._id,
                    variant_id: createdVariantsMap['sp_ly_gom'][0]._id,
                    title: createdProductMap['sp_ly_gom'].title,
                    color: createdVariantsMap['sp_ly_gom'][0].color,
                    quantity: 1,
                    base_cost: createdVariantsMap['sp_ly_gom'][0].base_cost,
                    retail_price: createdVariantsMap['sp_ly_gom'][0].retail_price,
                    image: createdProductMap['sp_ly_gom'].images[0]
                },
                {
                    product_id: createdProductMap['sp_binh_hoa']._id,
                    variant_id: createdVariantsMap['sp_binh_hoa'][0]._id,
                    title: createdProductMap['sp_binh_hoa'].title,
                    color: createdVariantsMap['sp_binh_hoa'][0].color,
                    quantity: 1,
                    base_cost: createdVariantsMap['sp_binh_hoa'][0].base_cost,
                    retail_price: createdVariantsMap['sp_binh_hoa'][0].retail_price,
                    image: createdProductMap['sp_binh_hoa'].images[0]
                }
            ],
            financial_breakdown: {
                subtotal: mongoose.Types.Decimal128.fromString('545000'),
                shipping_fee: mongoose.Types.Decimal128.fromString('30000'),
                coupon_discount: mongoose.Types.Decimal128.fromString('0'),
                platform_fee: mongoose.Types.Decimal128.fromString('27250'),
                seller_payout_amount: mongoose.Types.Decimal128.fromString('517750')
            },
            status_history: [
                { status: 'ORDERED', changed_at: new Date(Date.now() - 7 * 86400000) },
                { status: 'PROCESSING', changed_at: new Date(Date.now() - 6 * 86400000) },
                { status: 'SHIPPING', changed_at: new Date(Date.now() - 4 * 86400000) },
                { status: 'DELIVERED', changed_at: new Date(Date.now() - 2 * 86400000), note: 'Giao hàng thành công' }
            ],
            order_hour_of_week: 14
        },
        { upsert: true, new: true }
    );

    const deliveredOrder2 = await Order.findOneAndUpdate(
        { order_code: 'VC-DELIVERED-002' },
        {
            buyer_id: buyerTest._id,
            shop_id: shop2._id,
            order_code: 'VC-DELIVERED-002',
            payment_method: 'VNPAY',
            payment_status: 'PAID',
            order_status: 'DELIVERED',
            shipping_address: {
                recipient_name: buyerTest.full_name,
                phone: buyerTest.phone || '0901234567',
                address_detail: 'Số 12 Ngõ 45 Đường Láng, Phường Láng Thượng',
                province_id: '01',
                district_id: '006',
                ward_code: '00205'
            },
            shipping_details: {
                carrier: 'ghtk',
                tracking_number: 'GHTK-VC-991283',
                shipping_fee: mongoose.Types.Decimal128.fromString('25000')
            },
            items: [
                {
                    product_id: createdProductMap['sp_vi_da']._id,
                    variant_id: createdVariantsMap['sp_vi_da'][0]._id,
                    title: createdProductMap['sp_vi_da'].title,
                    color: createdVariantsMap['sp_vi_da'][0].color,
                    quantity: 1,
                    base_cost: createdVariantsMap['sp_vi_da'][0].base_cost,
                    retail_price: createdVariantsMap['sp_vi_da'][0].retail_price,
                    image: createdProductMap['sp_vi_da'].images[0]
                }
            ],
            financial_breakdown: {
                subtotal: mongoose.Types.Decimal128.fromString('380000'),
                shipping_fee: mongoose.Types.Decimal128.fromString('25000'),
                coupon_discount: mongoose.Types.Decimal128.fromString('0'),
                platform_fee: mongoose.Types.Decimal128.fromString('19000'),
                seller_payout_amount: mongoose.Types.Decimal128.fromString('361000')
            },
            status_history: [
                { status: 'ORDERED', changed_at: new Date(Date.now() - 5 * 86400000) },
                { status: 'DELIVERED', changed_at: new Date(Date.now() - 1 * 86400000), note: 'Đã nhận hàng' }
            ],
            order_hour_of_week: 10
        },
        { upsert: true, new: true }
    );

    // 7. Tạo 12 Đánh giá chân thực (Realistic Reviews) từ các khách hàng trước
    logger.info('Tạo 12 bài đánh giá chân thực phân bố 4-5 sao...');

    const reviewsData = [
        {
            prodKey: 'sp_ly_gom',
            shop: shop1,
            buyer: seededBuyers[1], // Trần Ngọc Mai
            rating: 5,
            comment: 'Bộ ly gốm rất đẹp, lớp men lam mộc tự nhiên cầm rất đầm tay. Shop đóng gói tới 3 lớp bóng xốp, mở ra nguyên vẹn không sứt mẻ xíu nào. Sẽ ủng hộ xưởng gốm dài dài!',
            daysAgo: 12,
            images: ['https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=300']
        },
        {
            prodKey: 'sp_ly_gom',
            shop: shop1,
            buyer: seededBuyers[2], // Nguyễn Hoàng Long
            rating: 5,
            comment: 'Hàng thủ công chuẩn Bát Tràng, mỗi ly có vân men chảy tự nhiên độc bản rất nghệ thuật. Pha trà mạn hay cà phê đều giữ nhiệt cực tốt.',
            daysAgo: 9,
            images: []
        },
        {
            prodKey: 'sp_ly_gom',
            shop: shop1,
            buyer: seededBuyers[3], // Lê Phương Anh
            rating: 4,
            comment: 'Ly đẹp như hình quảng cáo, chất men mịn màng. Giao hàng Hà Nội - Sài Gòn chỉ mất 2 ngày. Điểm trừ nhỏ là quai cầm hơi nhỏ với tay nam một chút, còn lại đều hoàn hảo.',
            daysAgo: 6,
            images: []
        },
        {
            prodKey: 'sp_binh_hoa',
            shop: shop1,
            buyer: seededBuyers[4], // Phạm Quốc Bảo
            rating: 5,
            comment: 'Bình hoa cắm cành đào hay hoa sen đều quá hợp. Men gốm thô mộc phong cách Wabi Sabi chuẩn gu mình tìm bấy lâu nay. 10/10 chất lượng!',
            daysAgo: 15,
            images: ['https://images.unsplash.com/photo-1581783342308-f792dbdd27c5?auto=format&fit=crop&w=300']
        },
        {
            prodKey: 'sp_binh_hoa',
            shop: shop1,
            buyer: seededBuyers[5], // Vũ Thùy Dương
            rating: 5,
            comment: 'Bình hoa đẹp tinh tế, đường khía chạm khắc thủ công sắc sảo. Để ở góc phòng khách ai tới chơi cũng khen. Rất đáng đồng tiền bát gạo.',
            daysAgo: 4,
            images: []
        },
        {
            prodKey: 'sp_vi_da',
            shop: shop2,
            buyer: seededBuyers[2], // Nguyễn Hoàng Long
            rating: 5,
            comment: 'Da sáp ngựa điên cực chất, mùi da tự nhiên thơm nhẹ không nồng hóa chất. Đường chỉ may tay chắc nịch, dùng càng lâu lên patina càng đẹp.',
            daysAgo: 14,
            images: ['https://images.unsplash.com/photo-1627123424574-724758594e93?auto=format&fit=crop&w=300']
        },
        {
            prodKey: 'sp_vi_da',
            shop: shop2,
            buyer: seededBuyers[4], // Phạm Quốc Bảo
            rating: 5,
            comment: 'Ví cầm êm tay, các ngăn thẻ vừa vặn khít khao. Hộp đựng bằng gỗ kèm túi rút chỉn chu, mang làm quà tặng đối tác thì quá sang trọng.',
            daysAgo: 8,
            images: []
        },
        {
            prodKey: 'sp_vi_da',
            shop: shop2,
            buyer: seededBuyers[1], // Trần Ngọc Mai
            rating: 4,
            comment: 'Mua tặng sinh nhật bạn trai, bạn ấy mê tít. Da lúc đầu hơi cứng một xíu nhưng xoa tay vài ngày là mềm ra bóng bẩy. Shop tư vấn rất nhiệt tình.',
            daysAgo: 3,
            images: []
        },
        {
            prodKey: 'sp_so_tay',
            shop: shop2,
            buyer: seededBuyers[3], // Lê Phương Anh
            rating: 5,
            comment: 'Sổ tay vintage đúng điệu, giấy kraft dày dặn viết bút máy không hề bị lem mực ra mặt sau. Bìa da bò sáp thật xước nhẹ lấy tay miết là hết. Rất ưng!',
            daysAgo: 18,
            images: []
        },
        {
            prodKey: 'sp_so_tay',
            shop: shop2,
            buyer: seededBuyers[5], // Vũ Thùy Dương
            rating: 5,
            comment: 'Đóng gói đẹp mắt như một gói quà xưa. Chất lượng giấy và da không có chỗ nào để chê. Dùng làm sổ nhật ký hành trình rất truyền cảm hứng.',
            daysAgo: 7,
            images: ['https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=300']
        },
        {
            prodKey: 'sp_that_lung',
            shop: shop2,
            buyer: seededBuyers[2], // Nguyễn Hoàng Long
            rating: 5,
            comment: 'Thắt lưng da nguyên tấm 1 lớp dày 4mm không chắp vá, khóa đồng đúc nặng tay. Dây lưng này dùng 5-10 năm chắc cũng không thể hỏng được.',
            daysAgo: 11,
            images: []
        },
        {
            prodKey: 'sp_tote_canvas',
            shop: shop1,
            buyer: seededBuyers[1], // Trần Ngọc Mai
            rating: 5,
            comment: 'Túi tote canvas dày dặn, họa tiết thêu hạc chỉ vàng cực kỳ tỉ mỉ không có cọng chỉ thừa. Đựng vừa laptop 14 inch đi làm vừa tiện vừa xinh.',
            daysAgo: 5,
            images: []
        }
    ];

    for (let i = 0; i < reviewsData.length; i++) {
        const rd = reviewsData[i];
        const prod = createdProductMap[rd.prodKey];
        if (!prod) continue;

        // Tạo order giả tương ứng cho review nếu cần
        const mockOrderCode = `VC-HISTORIC-${1000 + i}`;
        let histOrder = await Order.findOne({ order_code: mockOrderCode });
        if (!histOrder) {
            histOrder = await Order.create({
                buyer_id: rd.buyer._id,
                shop_id: rd.shop._id,
                order_code: mockOrderCode,
                payment_method: 'COD',
                payment_status: 'PAID',
                order_status: 'DELIVERED',
                shipping_address: {
                    recipient_name: rd.buyer.full_name,
                    phone: rd.buyer.phone || '0901234567',
                    address_detail: 'Việt Nam',
                    province_id: '01',
                    district_id: '001',
                    ward_code: '00001'
                },
                shipping_details: {
                    carrier: 'ghn',
                    tracking_number: `GHN-${1000 + i}`,
                    shipping_fee: mongoose.Types.Decimal128.fromString('30000')
                },
                items: [{
                    product_id: prod._id,
                    variant_id: createdVariantsMap[rd.prodKey][0]._id,
                    title: prod.title,
                    quantity: 1,
                    base_cost: createdVariantsMap[rd.prodKey][0].base_cost,
                    retail_price: createdVariantsMap[rd.prodKey][0].retail_price,
                    image: prod.images[0]
                }],
                financial_breakdown: {
                    subtotal: createdVariantsMap[rd.prodKey][0].retail_price,
                    shipping_fee: mongoose.Types.Decimal128.fromString('30000'),
                    coupon_discount: mongoose.Types.Decimal128.fromString('0'),
                    platform_fee: mongoose.Types.Decimal128.fromString('15000'),
                    seller_payout_amount: createdVariantsMap[rd.prodKey][0].retail_price
                },
                status_history: [{ status: 'DELIVERED', changed_at: new Date(Date.now() - rd.daysAgo * 86400000) }],
                order_hour_of_week: 12
            });
        }

        const reviewDate = new Date(Date.now() - rd.daysAgo * 86400000);
        await Review.findOneAndUpdate(
            { order_id: histOrder._id, product_id: prod._id },
            {
                order_id: histOrder._id,
                product_id: prod._id,
                shop_id: rd.shop._id,
                buyer_id: rd.buyer._id,
                rating: rd.rating,
                comment: rd.comment,
                images: rd.images,
                created_at: reviewDate,
                updated_at: reviewDate
            },
            { upsert: true }
        );
    }

    // 8. Tự động tính toán lại điểm đánh giá cho tất cả Sản phẩm & Shop
    logger.info('Tính toán lại ratings cho các Sản phẩm và Shop...');
    for (const key of Object.keys(createdProductMap)) {
        const p = createdProductMap[key];
        await Review.recalculateRatings(p._id, p.shop_id);
    }

    logger.info('=== NẠP DỮ LIỆU SEED THỰC TẾ THÀNH CÔNG RỰC RỠ! ===');
    return {
        shops: [shop1.shop_name, shop2.shop_name],
        productsCount: Object.keys(createdProductMap).length,
        buyerTest: {
            email: 'buyer.test@vietcraft.local',
            password: SEED_PASSWORD,
            deliveredOrders: ['VC-DELIVERED-001', 'VC-DELIVERED-002']
        }
    };
}

// Nếu chạy trực tiếp bằng lệnh terminal (standalone script)
if (require.main === module || process.argv[1]?.includes('seed_realistic_data')) {
    (async () => {
        try {
            const uri = config.mongoUri.includes('mongodb.net') && !config.mongoUri.includes('/vietcraft?')
                ? config.mongoUri.replace('/?', '/vietcraft?')
                : config.mongoUri;
            await mongoose.connect(uri);
            await seedRealisticData();
            await mongoose.disconnect();
            process.exit(0);
        } catch (err) {
            console.error('Lỗi khi chạy seed:', err);
            process.exit(1);
        }
    })();
}
