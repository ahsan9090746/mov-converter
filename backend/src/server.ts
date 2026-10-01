import { createApp } from './app.js';
import { env } from './config/env.js';
import { verifyFfmpegOrThrow } from './services/ffmpeg.service.js';
import { cleanupStaleJobs, startCleanupScheduler, sweepOrphanDirs } from './services/cleanup.service.js';
import { ensureStorageRoot } from './utils/files.js';

async function main(): Promise<void> {
  await ensureStorageRoot();

  let ffmpegOk = false;
  try {
    verifyFfmpegOrThrow();
    ffmpegOk = true;
  } catch (err) {
    // Fail fast in production; in dev, start anyway so health checks work
    // but conversions will return a clear error.
    console.error('[STARTUP] FFmpeg check failed:', err instanceof Error ? err.message : err);
    if (env.nodeEnv === 'production') process.exit(1);
  }

  const app = createApp();
  // Listen on all interfaces (IPv4 + IPv6 dual-stack) so every
  // localhost spelling (localhost / 127.0.0.1 / ::1) can connect.
  // Render provides PORT; fall back locally.
  const PORT = Number(process.env.PORT) || env.port;

  app.listen(PORT, () => {
    console.log(`[SERVER] API listening on :${PORT} (env=${env.nodeEnv}, ffmpeg=${ffmpegOk ? 'ok' : 'MISSING'})`);
    console.log(`[CONFIG] maxFileSize=${env.maxFileSizeMb}MB cleanupAfter=${env.cleanupAfterMinutes}min frontend=${env.frontendUrl}`);
  });

  // Initial sweep + periodic cleanup (ephemeral filesystem: never keep files).
  cleanupStaleJobs().catch(() => undefined);
  sweepOrphanDirs().catch(() => undefined);
  startCleanupScheduler();
}

main().catch((err) => {
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
