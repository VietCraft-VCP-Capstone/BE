import express from 'express';
import cors from 'cors';
import path from 'path';
import { requestLogger } from './middleware/request-id.middleware';
import { errorHandler } from './middleware/error.middleware';
import router from './routes';

const app = express();

// Trust proxy từ Nginx API Gateway để đọc đúng IP client và IPN VNPay
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(requestLogger);

// Ảnh design/mockup lưu local (P3/P4). ponytail: static serve, đổi sang CDN sau.
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

app.use('/health', (req, res) => {
    res.json({ status: 'ok', service: 'backend-core', timestamp: new Date() });
});

app.use('/api', router);

// Route không tồn tại -> JSON 404 (mặc định Express trả HTML, FE parse lỗi).
app.use((req, res) => {
    res.status(404).json({ error: `Not Found: ${req.method} ${req.originalUrl}` });
});

app.use(errorHandler);

export { app };
export default app;
