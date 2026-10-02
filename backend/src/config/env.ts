import dotenv from 'dotenv';

dotenv.config();

function toInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toText(value: string | undefined, fallback: string): string {
  const v = (value ?? '').trim();
  return v.length > 0 ? v : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: toInt(process.env.PORT, 8000),
  frontendUrl: (process.env.FRONTEND_URL ?? 'http://localhost:4000,http://127.0.0.1:4000').trim(),
  maxFileSizeMb: toInt(process.env.MAX_FILE_SIZE_MB, 500),
  // Bulk cap: size of ONE batch the UI will queue. Set high so users can
  // convert "unlimited" files in one go. The queue still processes them
  // sequentially (MAX_CONCURRENT_CONVERSIONS) to protect CPU/RAM, and
  // status/ZIP endpoints accept up to BATCH_HARD_MAX ids per request with
  // the frontend auto-chunking larger lists.
  maxFilesPerBatch: toInt(process.env.MAX_FILES_PER_BATCH, 500),
  cleanupAfterMinutes: toInt(process.env.CLEANUP_AFTER_MINUTES, 30),
  ffmpegPath: (process.env.FFMPEG_PATH ?? '').trim() || undefined,
  ffprobePath: (process.env.FFPROBE_PATH ?? '').trim() || undefined,
  maxConcurrentConversions: toInt(process.env.MAX_CONCURRENT_CONVERSIONS, 2),
  rateLimitWindowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  rateLimitMax: toInt(process.env.RATE_LIMIT_MAX, 2000),
  // Quality settings: visually-lossless H.264. CRF 18 ≈ no visible loss
  // (old default 26 = visible loss). Preset veryfast = best speed/quality
  // balance (ultrafast = faster but worse quality per bit).
  videoPreset: toText(process.env.VIDEO_PRESET, 'veryfast'),
  videoCrf: toInt(process.env.VIDEO_CRF, 18),
  audioBitrate: toText(process.env.AUDIO_BITRATE, '192k'),
};

export const isProduction = env.nodeEnv === 'production';
