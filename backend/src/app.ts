import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { conversionRouter } from './routes/conversion.routes.js';
import { errorHandler, httpError, notFoundHandler } from './middleware/error.middleware.js';

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins(env.frontendUrl);
// Log allowed origins at startup (origins are not secrets).
console.log(`[CORS] Allowed origins: ${allowedOrigins.length > 0 ? allowedOrigins.join(', ') : '(none — same-origin / curl only)'}`);

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow same-origin / curl / health checks with no Origin header.
    if (!origin) {
      callback(null, true);
      return;
    }
    if (allowedOrigins.includes(normalizeOrigin(origin))) {
      callback(null, true);
      return;
    }
    console.warn(`[CORS] Blocked origin: ${origin}`);
    callback(httpError(403, 'This origin is not allowed to use the converter API.'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range'],
  exposedHeaders: ['Content-Disposition'],
  maxAge: 600,
};

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');

  // CORS FIRST: every response — including 4xx/5xx/413/429 and error-handler
  // responses — must carry Access-Control-Allow-Origin so the browser can
  // read the real error message instead of failing with a CORS error.
  app.use(cors(corsOptions));
  // Explicit preflight handler for all routes.
  app.options('*', cors(corsOptions));

  // cross-origin (not same-site) so MP4/ZIP downloads work from the frontend origin.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

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
    res.json({
      success: true,
      status: 'healthy',
      maxFileSizeMb: env.maxFileSizeMb,
      maxFilesPerBatch: env.maxFilesPerBatch,
    });
  });

  app.use('/api', conversionRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
