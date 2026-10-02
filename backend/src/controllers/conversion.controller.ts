import { ZipArchive } from 'archiver';
import fs from 'node:fs';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { jobStore } from '../jobs/job.store.js';
import { convertMovToMp4 } from '../services/ffmpeg.service.js';
import { deleteJobFiles } from '../services/cleanup.service.js';
import { ensureJobDir, pathExists, safeJobPath, toSafeDownloadName } from '../utils/files.js';
import { httpError } from '../middleware/error.middleware.js';
import type { ConvertRequest } from '../middleware/upload.middleware.js';
import type { ConversionJob, JobStatus } from '../types/job.js';

// Simple in-process concurrency guard + FIFO queue (single instance V1).
// Jobs beyond MAX_CONCURRENT_CONVERSIONS wait with status "queued"
// instead of being rejected, so bulk batches always make progress.
let activeConversions = 0;
const pendingQueue: string[] = [];

// Hard per-request guards (DoS protection). The UI batch size
// (env.maxFilesPerBatch, default 500) is the soft UX limit; these are the
// absolute per-request ceilings — the frontend chunks bigger lists.
const BATCH_HARD_MAX = 500;
const ZIP_HARD_MAX = 500;

export function isValidJobId(jobId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId);
}

async function runConversion(jobId: string): Promise<void> {
  const job = jobStore.get(jobId);
  if (!job) return;
  activeConversions += 1;
  jobStore.update(jobId, { status: 'processing', progress: 5, stage: 'converting' });
  try {
    await convertMovToMp4({
      inputPath: job.inputPath,
      outputPath: job.outputPath,
      onProgress: (pct) => {
        // Map ffmpeg 0-99 -> job 5-95 so UI stages stay truthful.
        const mapped = 5 + Math.round((pct / 100) * 90);
        jobStore.update(jobId, { progress: mapped, stage: 'converting' });
      },
    });

    const exists = await pathExists(job.outputPath);
    if (!exists) throw new Error('Conversion produced no output file.');

    jobStore.update(jobId, { status: 'completed', progress: 100, stage: 'done' });
    console.log(`[CONVERSION_COMPLETED] job=${jobId}`);

    // Best-effort: remove bulky source file, keep output for download.
    await fs.promises.rm(job.inputPath, { force: true }).catch(() => undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Conversion failed.';
    jobStore.update(jobId, { status: 'failed', progress: 0, stage: 'failed', error: message });
    console.error(`[CONVERSION_FAILED] job=${jobId} reason=${message}`);
  } finally {
    activeConversions = Math.max(0, activeConversions - 1);
    pumpQueue();
  }
}

function pumpQueue(): void {
  while (activeConversions < env.maxConcurrentConversions && pendingQueue.length > 0) {
    const nextId = pendingQueue.shift() as string;
    const job = jobStore.get(nextId);
    // Job may have expired while queued — skip silently, keep pumping.
    if (!job || job.status !== 'queued') continue;
    console.log(`[QUEUE] dequeued job=${nextId}`);
    void runConversion(nextId);
  }
}

export async function handleConvert(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { jobId } = req as ConvertRequest;
    if (!jobId || !isValidJobId(jobId)) {
      throw httpError(400, 'Invalid upload session. Please try again.');
    }
    if (!req.file) {
      throw httpError(400, 'No file uploaded. Please choose a MOV file.');
    }

    // diskStorage already streamed the upload to storage/jobs/<jobId>/input.mov.
    const jobDir = await ensureJobDir(jobId);
    const inputPath = safeJobPath(jobDir, 'input.mov');
    const outputPath = safeJobPath(jobDir, 'output.mp4');

    console.log(`[UPLOAD] job=${jobId} name=${req.file.originalname} size=${req.file.size} bytes`);

    const downloadFileName = toSafeDownloadName(req.file.originalname);

    const queued = activeConversions >= env.maxConcurrentConversions;
    if (queued) pendingQueue.push(jobId);

    jobStore.create({
      jobId,
      status: queued ? 'queued' : 'processing',
      progress: queued ? 0 : 5,
      stage: queued ? 'queued' : 'converting',
      inputPath,
      outputPath,
      originalName: req.file.originalname.slice(0, 200),
      downloadFileName,
      jobDir,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    console.log(`[CONVERSION_${queued ? 'QUEUED' : 'STARTED'}] job=${jobId}`);

    // Return immediately; conversion runs in background (or waits in queue).
    res.status(202).json({ success: true, jobId, status: queued ? 'queued' : 'processing' });

    if (!queued) void runConversion(jobId);
  } catch (err) {
    next(err);
  }
}

export function handleStatus(req: Request, res: Response, next: NextFunction): void {
  try {
    const { jobId } = req.params;
    if (!jobId || !isValidJobId(jobId)) throw httpError(404, 'Job not found or expired.');
    const job = jobStore.get(jobId);
    if (!job) throw httpError(404, 'Job not found or expired.');

    if (job.status === 'completed') {
      res.json({
        success: true,
        status: 'completed',
        progress: 100,
        downloadUrl: `/api/download/${job.jobId}`,
      });
      return;
    }
    if (job.status === 'failed') {
      res.status(422).json({
        success: false,
        status: 'failed',
        progress: 0,
        message: job.error ?? 'Conversion failed.',
      });
      return;
    }
    res.json({ success: true, status: job.status, progress: job.progress });
  } catch (err) {
    next(err);
  }
}

export interface BatchJobEntry {
  jobId: string;
  status: JobStatus | 'expired';
  progress: number;
  downloadUrl?: string;
  message?: string;
}

/** Poll many jobs in one request: POST /api/status/batch { jobIds: string[] }. */
export function handleStatusBatch(req: Request, res: Response, next: NextFunction): void {
  try {
    const { jobIds } = (req.body ?? {}) as { jobIds?: unknown };
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      throw httpError(400, 'Provide jobIds as a non-empty array of job ids.');
    }
    // Hard per-request cap (DoS guard). The frontend auto-chunks larger
    // bulk lists into multiple batch requests, so "unlimited" files still work.
    if (jobIds.length > BATCH_HARD_MAX) {
      throw httpError(400, `Too many job ids per request. Maximum ${BATCH_HARD_MAX} — the app splits bigger batches automatically.`);
    }
    const jobs: BatchJobEntry[] = jobIds.map((id) => {
      if (typeof id !== 'string' || !isValidJobId(id)) {
        throw httpError(400, 'Each job id must be a valid UUID.');
      }
      const job = jobStore.get(id);
      if (!job) return { jobId: id, status: 'expired' as const, progress: 0 };
      const entry: BatchJobEntry = { jobId: id, status: job.status, progress: job.progress };
      if (job.status === 'completed') entry.downloadUrl = `/api/download/${job.jobId}`;
      if (job.status === 'failed') entry.message = job.error ?? 'Conversion failed.';
      return entry;
    });
    res.json({ success: true, jobs });
  } catch (err) {
    next(err);
  }
}

/**
 * Stream a ZIP of completed MP4s.
 *  - GET  /api/download-zip?ids=a,b,c   (small batches, shareable link)
 *  - POST /api/download-zip { ids: [...] } (large/unlimited batches — avoids URL-length limits)
 * Validates every id (UUID, exists, completed, file present). Names come
 * from the sanitized per-job download names, so no path traversal is possible.
 * NOTE: a ZIP download intentionally does NOT delete the jobs (individual
 * downloads still delete ~5s after delivery; the stale sweeper cleans the
 * rest), so individual links keep working after a ZIP download.
 */
export async function handleDownloadZip(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let ids: string[] = [];
    if (req.method === 'POST') {
      const body = (req.body ?? {}) as { ids?: unknown };
      if (!Array.isArray(body.ids)) throw httpError(400, 'Provide ids as an array of job ids, e.g. { "ids": ["<id1>", "<id2>"] }.');
      ids = body.ids.map((s) => String(s).trim()).filter(Boolean);
    } else {
      const raw = req.query.ids;
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        throw httpError(400, 'Provide ids as a comma-separated list, e.g. ?ids=<id1>,<id2>.');
      }
      ids = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (ids.length === 0) throw httpError(400, 'Provide at least one job id.');
    if (ids.length > ZIP_HARD_MAX) {
      throw httpError(400, `Too many ids per ZIP request. Maximum ${ZIP_HARD_MAX} — download the rest as a second ZIP.`);
    }

    const ready: ConversionJob[] = [];
    for (const id of ids) {
      if (!isValidJobId(id)) throw httpError(400, 'Each id must be a valid job id.');
      const job = jobStore.get(id);
      if (!job) throw httpError(404, 'A file was not found or expired. Please convert again.');
      if (job.status !== 'completed') throw httpError(409, 'A conversion is not ready yet. Wait for all files to finish.');
      const exists = await pathExists(job.outputPath);
      if (!exists) throw httpError(410, 'A file expired and was cleaned up. Please convert again.');
      ready.push(job);
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="converted-videos.zip"');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Store (no recompression): MP4s are already compressed, level 0 is fastest.
    const archive = new ZipArchive({ zlib: { level: 0 } });
    archive.on('error', (err) => {
      console.error('[ZIP_FAILED]', err instanceof Error ? err.message : err);
      if (!res.headersSent) next(httpError(500, 'Failed to build the ZIP archive.'));
      else res.end();
    });
    req.on('close', () => {
      try {
        archive.abort();
      } catch {
        // ignore — stream already finished
      }
    });
    archive.pipe(res);

    // Deduplicate names (two uploads can share a sanitized file name).
    const usedNames = new Set<string>();
    for (const job of ready) {
      let name = job.downloadFileName;
      let n = 1;
      while (usedNames.has(name)) {
        n += 1;
        name = job.downloadFileName.replace(/\.mp4$/i, `-${n}.mp4`);
      }
      usedNames.add(name);
      archive.file(job.outputPath, { name });
    }
    await archive.finalize();
  } catch (err) {
    next(err);
  }
}

export async function handleDownload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { jobId } = req.params;
    if (!jobId || !isValidJobId(jobId)) throw httpError(404, 'File not found or expired.');
    const job = jobStore.get(jobId);
    if (!job) throw httpError(404, 'File not found or expired.');
    if (job.status !== 'completed') throw httpError(409, 'Conversion is not ready yet.');

    const exists = await pathExists(job.outputPath);
    if (!exists) throw httpError(410, 'File expired and was cleaned up. Please convert again.');

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${job.downloadFileName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Stream the file; schedule deletion AFTER response completes.
    const stream = fs.createReadStream(job.outputPath);
    stream.on('error', () => {
      if (!res.headersSent) next(httpError(500, 'Failed to read converted file.'));
      else res.end();
    });
    res.on('finish', () => {
      // Delete shortly after successful download so the response is fully flushed.
      setTimeout(() => {
        deleteJobFiles(jobId)
          .then(() => jobStore.remove(jobId))
          .catch(() => undefined);
      }, 5_000);
    });
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}
