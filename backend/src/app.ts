import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { conversionRouter } from './routes/conversion.routes.js';
import { errorHandler, httpError, notFoundHandler } from './middleware/error.middleware.js';

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));

  // Configurable CORS — never "*" in production.
  const allowedOrigins = env.frontendUrl
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow same-origin / curl / health checks with no Origin header.
        if (!origin) {
          callback(null, true);
          return;
        }
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(httpError(403, 'This origin is not allowed to use the converter API.'));
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Range'],
      maxAge: 600,
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  const globalLimiter = rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.rateLimitMax * 2,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
  app.use(globalLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({ success: true, status: 'healthy' });
  });

  app.use('/api', conversionRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
