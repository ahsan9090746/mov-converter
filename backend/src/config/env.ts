import dotenv from 'dotenv';

dotenv.config();

function toInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: toInt(process.env.PORT, 8000),
  frontendUrl: (process.env.FRONTEND_URL ?? 'http://localhost:4000,http://127.0.0.1:4000').trim(),
  maxFileSizeMb: toInt(process.env.MAX_FILE_SIZE_MB, 500),
  cleanupAfterMinutes: toInt(process.env.CLEANUP_AFTER_MINUTES, 30),
  ffmpegPath: (process.env.FFMPEG_PATH ?? '').trim() || undefined,
  maxConcurrentConversions: toInt(process.env.MAX_CONCURRENT_CONVERSIONS, 2),
  rateLimitWindowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  rateLimitMax: toInt(process.env.RATE_LIMIT_MAX, 100),
};

export const isProduction = env.nodeEnv === 'production';
