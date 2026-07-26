import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { env } from './env';
import { errorHandler } from './lib/http';
import { authenticate } from './middleware/auth';
import authRoutes from './routes/auth.routes';
import metaRoutes from './routes/meta.routes';
import usersRoutes from './routes/users.routes';
import mastersRoutes from './routes/masters.routes';
import productsRoutes from './routes/products.routes';

const app = express();

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'saraswati-erp' }));

// Serve uploaded product images.
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/meta', authenticate, metaRoutes);
app.use('/api/users', usersRoutes);
app.use('/api', mastersRoutes);
app.use('/api/products', productsRoutes);

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`\n  Saraswati ERP API running at http://localhost:${env.PORT}\n`);
});
