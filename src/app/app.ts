import express from 'express';
import cors from 'cors';
import path from 'path';
import { requestLogger } from './middleware/request-id.middleware';
import { errorHandler } from './middleware/error.middleware';
import { config } from './config';
import router from './routes';


const app = express();

app.disable('x-powered-by');

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // API chỉ trả JSON/ảnh: không cho chạy script hay nhúng khung
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; frame-ancestors 'none'");
    if (config.nodeEnv === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// Chỉ tin X-Forwarded-For khi thật sự có proxy phía trước (TRUST_PROXY = số proxy)
app.set('trust proxy', config.trustProxy);

const allowedOrigins = [
    config.frontendUrl,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8880',
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || config.nodeEnv !== 'production') {
            callback(null, true);
        } else {
            callback(null, false);   // không cấp header CORS, trình duyệt tự chặn (không ném lỗi thành 500)
        }
    },
    credentials: true,
}));

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(requestLogger);

// Ảnh design/mockup lưu local (P3/P4). ponytail: static serve, đổi sang CDN sau.
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));
app.use('/images', express.static(path.resolve(process.cwd(), '..', 'frontend', 'public', 'images')));

// Công khai: chỉ báo còn sống, không lộ trạng thái hạ tầng (Redis) hay giờ máy chủ
app.use('/health', (_req, res) => {
    res.json({ status: 'ok' });
});

app.use('/api', router);

// Route không tồn tại -> JSON 404 (mặc định Express trả HTML, FE parse lỗi).
app.use((req, res) => {
    res.status(404).json({ error: `Not Found: ${req.method} ${req.originalUrl}` });
});

app.use(errorHandler);

export { app };
export default app;
