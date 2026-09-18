import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../../modules/product/infrastructure/models/product.model';
import { Shop } from '../../modules/product/infrastructure/models/shop.model';
import { User } from '../../modules/user/infrastructure/models/user.model';
import { Coupon } from '../../modules/promotion/infrastructure/models/coupon.model';

dotenv.config();

const SEED_EMAILS = [
    'gom.moc@vietcraft.local',
    'xuong.da@vietcraft.local',
    'tiem.tranh@vietcraft.local',
];

export async function cleanMockData() {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
        console.error('MONGO_URI is not set.');
        process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB. Starting mock data cleanup...');

    const delProducts = await Product.deleteMany({ slug: { $regex: '^seed-' } });
    console.log(`- Deleted ${delProducts.deletedCount} seed products (slug starting with 'seed-')`);

    const delShops = await Shop.deleteMany({ slug: { $regex: '^seed-' } });
    console.log(`- Deleted ${delShops.deletedCount} seed shops (slug starting with 'seed-')`);

    const delUsers = await User.deleteMany({ email: { $in: SEED_EMAILS } });
    console.log(`- Deleted ${delUsers.deletedCount} seed demo seller accounts`);

    console.log('Mock data cleanup completed successfully.');
    await mongoose.disconnect();
}

if (require.main === module) {
    cleanMockData().catch(err => {
        console.error('Error during cleanup:', err);
        process.exit(1);
    });
}
