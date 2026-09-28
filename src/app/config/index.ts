import dotenv from 'dotenv';
import { Pool } from 'pg';
import mongoose from 'mongoose';
import { createClient } from 'redis';
import { logger } from '../../shared/utils/logger';

dotenv.config();

/**
 * Đọc `AI_SHOP_MAP` dạng `email=shop,email2=shop2` thành map email đã hạ chữ thường.
 *
 * Bỏ qua mục sai cú pháp thay vì ném lỗi: một dấu phẩy thừa trong .env không đáng để
 * làm sập cả server, và phần còn lại của map vẫn dùng được.
 */
function parseShopMap(raw?: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const pair of (raw || '').split(',')) {
        const [email, shop] = pair.split('=').map(s => s?.trim());
        if (!email || !shop) continue;
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(shop)) continue;
        out[email.toLowerCase()] = shop;
    }
    return out;
}

export const config = {
    port: process.env.PORT || 8080,
    nodeEnv: process.env.NODE_ENV || 'development',
    databaseUrl: process.env.DATABASE_URL || '',
    mongoUri: process.env.MONGO_URI || '',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    jwtSecret: process.env.JWT_SECRET || '',
    aiAnalyticsUrl: process.env.AI_ANALYTICS_URL || 'http://localhost:8000',
    // Bí mật dùng chung BE <-> service AI. Phải trùng AI_GATEWAY_SECRET bên AI-Analysic.
    aiGatewaySecret: process.env.AI_GATEWAY_SECRET || '',
    // Shop mẫu trong dữ liệu mồi (vd shp_00017). Có giá trị = chế độ demo: mọi seller xem
    // số liệu của shop mẫu, FE hiện nhãn "shop mẫu". Để trống = gửi shop thật của seller.
    aiDemoShopId: process.env.AI_DEMO_SHOP_ID || '',
    // Ánh xạ RIÊNG từng người bán sang một shop mẫu, dạng `email=shp_00017,email2=shp_00005`.
    // Dùng khi một account cần xem đủ 16 màn hình để demo hoặc kiểm thử, mà không phải
    // bật chế độ shop mẫu cho toàn bộ người bán. Ưu tiên cao hơn AI_DEMO_SHOP_ID.
    aiShopMap: parseShopMap(process.env.AI_SHOP_MAP),
    // SRS MSG132: service AI trả chậm hơn 5 giây là lỗi.
    aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS) || 5000,
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    mailUser: process.env.MAIL_USER || '',
    mailPass: process.env.MAIL_PASS || '',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    printerApiUrl: process.env.PRINTER_API_URL || 'http://localhost:8880',
    printerApiKey: process.env.PRINTER_API_KEY || '',
    printerWebhookSecret: process.env.PRINTER_WEBHOOK_SECRET || '',
    printerEnv: process.env.PRINTER_ENV || 'sandbox',
    // Lưu trữ ảnh seller upload. Thiếu credential -> tự fallback về đĩa local (BE/uploads).
    // Chỉ cần MỘT trong hai: cặp apiKey+apiSecret (signed) hoặc uploadPreset (unsigned).
    cloudinary: {
        url: process.env.CLOUDINARY_URL || '',
        cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
        apiKey: process.env.CLOUDINARY_API_KEY || '',
        apiSecret: process.env.CLOUDINARY_API_SECRET || '',
        uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || '',
        folder: process.env.CLOUDINARY_FOLDER || 'vietcraft',
        // Chỉ đổi khi chạy test hoặc đi qua proxy nội bộ. Bỏ trống = gọi thẳng Cloudinary.
        apiBase: process.env.CLOUDINARY_API_BASE || 'https://api.cloudinary.com',
    },
    // Shared secret cổng thanh toán dùng để ký webhook POST /orders/callback/:id.
    paymentCallbackSecret: process.env.PAYMENT_CALLBACK_SECRET || '',
    speedSmsAccessToken: process.env.SPEEDSMS_ACCESS_TOKEN || '',
    speedSmsType: Number(process.env.SPEEDSMS_SMS_TYPE) || 2,
    vnpay: {
        tmnCode: process.env.VNP_TMNCODE || 'R4B161KM',
        hashSecret: process.env.VNP_HASHSECRET || 'TYQBZSLIPCVPYOVJLCUTLHKTDTDFHJXA',
        url: process.env.VNP_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
        apiUrl: process.env.VNP_API_URL || 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction',
        returnUrl: process.env.VNP_RETURNURL || 'http://localhost:3000/orders/vnpay-return',
    },
};

if (!config.jwtSecret) {
    if (config.nodeEnv === 'production') {
        throw new Error('FATAL: JWT_SECRET environment variable is not defined.');
    } else {
        logger.warn('JWT_SECRET is not defined. Authentication features will fail.');
    }
}

// PostgreSQL pool
export const pgPool = new Pool({
    connectionString: config.databaseUrl || undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pgPool.on('error', (err) => {
    logger.error('PostgreSQL client error: ' + err.message);
});

export async function connectPostgres() {
    if (!config.databaseUrl) {
        logger.warn('DATABASE_URL is not defined. Skipping PostgreSQL connection.');
        return;
    }
    try {
        await pgPool.query('SELECT NOW()');
        logger.info('Connected to PostgreSQL successfully.');
    } catch (error: any) {
        logger.warn('Failed to connect to PostgreSQL. Running in demo fallback mode: ' + error.message);
    }
}

// MongoDB connection
export async function connectMongo() {
    if (!config.mongoUri) {
        logger.warn('Failed to connect to MongoDB: MONGO_URI is not defined.');
        return;
    }
    const uri = config.mongoUri.includes('mongodb.net') && !config.mongoUri.includes('/vietcraft?')
        ? config.mongoUri.replace('/?', '/vietcraft?')
        : config.mongoUri;
    try {
        mongoose.set('strictQuery', false);
        mongoose.set('bufferCommands', false);  // Fail immediately if not connected
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 8000,
            connectTimeoutMS: 8000,
        });
        logger.info('Connected to MongoDB successfully.');
    } catch (error: any) {
        logger.warn('Failed to connect to MongoDB: ' + error.message);
        logger.warn('Auth features require MongoDB. Add your IP to Atlas Network Access: https://cloud.mongodb.com');
    }
}

// Redis client
let redisIsReady = false;

export const redisClient = createClient({
    url: config.redisUrl,
    socket: {
        connectTimeout: 4000,
        reconnectStrategy: (retries) => {
            if (retries > 3) {
                return false; // stop reconnecting after 3 retries
            }
            return 2000; // try reconnecting after 2 seconds
        }
    }
});

redisClient.on('connect', () => {
    redisIsReady = true;
});

redisClient.on('ready', () => {
    redisIsReady = true;
});

redisClient.on('end', () => {
    redisIsReady = false;
});

redisClient.on('error', (err) => {
    redisIsReady = false;
    if (!err.message.includes('Closed') && !err.message.includes('ECONNREFUSED') && !err.message.includes('connect ECONNREFUSED')) {
        logger.error('Redis error: ' + err.message);
    }
});

export function isRedisReady(): boolean {
    return redisIsReady && Boolean(redisClient.isOpen);
}

export async function connectRedis() {
    try {
        await redisClient.connect();
        redisIsReady = true;
        logger.info(`Connected to Redis successfully .`);
    } catch (error: any) {
        redisIsReady = false;
        logger.warn('Failed to connect to Redis. Running in demo fallback mode (Direct DB): ' + error.message);
    }
}

export async function initializeDatabases() {
    await connectPostgres();
    await connectMongo();
    await connectRedis();
}
