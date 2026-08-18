import express from 'express';
import cors from 'cors';
import { requestLogger } from './middleware/request-id.middleware';
import { errorHandler } from './middleware/error.middleware';
import router from './routes';

const app = express();

app.use(cors());
app.use(express.json());
app.use(requestLogger);

app.use('/health', (req, res) => {
    res.json({ status: 'ok', service: 'backend-core', timestamp: new Date() });
});

app.use('/api', router);

app.use(errorHandler);

export { app };
export default app;
