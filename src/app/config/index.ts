import dotenv from 'dotenv';
import { Pool } from 'pg';
import mongoose from 'mongoose';
import { createClient } from 'redis';
import { logger } from '../../shared/utils/logger';

dotenv.config();

export const config = {
    port: process.env.PORT || 8080,
    nodeEnv: process.env.NODE_ENV || 'development',
    databaseUrl: process.env.DATABASE_URL || '',
    mongoUri: process.env.MONGO_URI || '',
    redisUrl: process.env.REDIS_URL || '',
    jwtSecret: process.env.JWT_SECRET || '',
    aiAnalyticsUrl: process.env.AI_ANALYTICS_URL || 'http://localhost:8000',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    mailUser: process.env.MAIL_USER || '',
    mailPass: process.env.MAIL_PASS || '',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    printerApiUrl: process.env.PRINTER_API_URL || 'http://localhost:8880',
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
export const redisClient = createClient({
    url: config.redisUrl,
    socket: {
        reconnectStrategy: (retries) => {
            if (retries > 3) {
                return false; // stop reconnecting
            }
            return 2000; // try reconnecting after 2 seconds
        }
    }
});

redisClient.on('error', (err) => {
    if (!err.message.includes('Closed') && !err.message.includes('ECONNREFUSED')) {
        logger.error('Redis error: ' + err.message);
    }
});

export async function connectRedis() {
    try {
        await redisClient.connect();
        logger.info('Connected to Redis successfully.');
    } catch (error: any) {
        logger.warn('Failed to connect to Redis. Running in demo fallback mode: ' + error.message);
    }
}

export async function initializeDatabases() {
    await connectPostgres();
    await connectMongo();
    await connectRedis();
}
