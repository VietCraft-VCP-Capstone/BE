import dotenv from 'dotenv';
import dns from 'dns';
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
    mongoDbData: process.env.MONGO_DB_DATA || 'data-collection',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    jwtSecret: process.env.JWT_SECRET || '',
    aiAnalyticsUrl: process.env.AI_ANALYTICS_URL || 'http://localhost:8000',
    aiGatewaySecret: process.env.AI_GATEWAY_SECRET || '',
    aiDemoShopId: process.env.AI_DEMO_SHOP_ID || '',
    aiShopMap: parseShopMap(process.env.AI_SHOP_MAP),
    aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS) || 5000,
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    mailUser: process.env.MAIL_USER || '',
    mailPass: process.env.MAIL_PASS || '',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    printerApiUrl: process.env.PRINTER_API_URL || 'http://localhost:8880',
    printerApiKey: process.env.PRINTER_API_KEY || '',
    printerRefundApiKey: process.env.PRINTER_REFUND_API_KEY || '',
    printerWebhookSecret: process.env.PRINTER_WEBHOOK_SECRET || '',
    printerEnv: process.env.PRINTER_ENV || 'sandbox',
    cloudinary: {
        url: process.env.CLOUDINARY_URL || '',
        cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
        apiKey: process.env.CLOUDINARY_API_KEY || '',
        apiSecret: process.env.CLOUDINARY_API_SECRET || '',
        uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || '',
        folder: process.env.CLOUDINARY_FOLDER || 'vietcraft',
        apiBase: process.env.CLOUDINARY_API_BASE || 'https://api.cloudinary.com',
    },
    paymentCallbackSecret: process.env.PAYMENT_CALLBACK_SECRET || '',
    payos: {
        // Thu tiền (payment link)
        clientId: process.env.PAYOS_CLIENT_ID || '',
        apiKey: process.env.PAYOS_API_KEY || '',
        checksumKey: process.env.PAYOS_CHECKSUM_KEY || '',
        baseUrl: process.env.PAYOS_BASE_URL || 'https://api-merchant.payos.vn',
        // Trang FE mở lại sau thanh toán/huỷ; mặc định {FRONTEND_URL}/orders/:id.
        checkoutReturnUrl: process.env.PAYOS_RETURN_URL || '',
        checkoutCancelUrl: process.env.PAYOS_CANCEL_URL || '',
        // Chi tiền (payout) để hoàn tiền tự động
        payoutClientId: process.env.PAYOS_PAYOUT_CLIENT_ID || '',
        payoutApiKey: process.env.PAYOS_PAYOUT_API_KEY || '',
        payoutChecksumKey: process.env.PAYOS_PAYOUT_CHECKSUM_KEY || '',
        payoutBaseUrl: process.env.PAYOS_PAYOUT_BASE_URL || 'https://api-merchant.payos.vn',
    },
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
export function isMongoReady(): boolean {
    return mongoose.connection.readyState === 1;
}

export async function connectMongo() {
    if (!config.mongoUri) {
        logger.warn('Failed to connect to MongoDB: MONGO_URI is not defined.');
        return;
    }
    const uri = config.mongoUri.includes('mongodb.net') && !config.mongoUri.includes('/vietcraft?')
        ? config.mongoUri.replace('/?', '/vietcraft?')
        : config.mongoUri;
    try {
        try {
            dns.setServers(['8.8.8.8', '1.1.1.1']);
        } catch {
            // ignore if not supported in environment
        }
        mongoose.set('strictQuery', false);
        mongoose.set('bufferCommands', false);
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
                return false;
            }
            return 2000;
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
