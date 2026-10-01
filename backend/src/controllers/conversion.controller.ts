import fs from 'node:fs';
import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env.js';
import { jobStore } from '../jobs/job.store.js';
import { convertMovToMp4 } from '../services/ffmpeg.service.js';
import { deleteJobFiles } from '../services/cleanup.service.js';
import { ensureJobDir, pathExists, safeJobPath, toSafeDownloadName } from '../utils/files.js';
import { httpError } from '../middleware/error.middleware.js';

// Simple in-process concurrency guard (single instance V1).
let activeConversions = 0;

function isValidJobId(jobId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId);
}

export async function handleConvert(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      throw httpError(400, 'No file uploaded. Please choose a MOV file.');
    }
    if (activeConversions >= env.maxConcurrentConversions) {
      throw httpError(429, 'Server is busy converting other videos. Please try again in a minute.');
    }

    const jobId = uuidv4();
    const jobDir = await ensureJobDir(jobId);
    const inputPath = safeJobPath(jobDir, 'input.mov');
    const outputPath = safeJobPath(jobDir, 'output.mp4');

    await fs.promises.writeFile(inputPath, req.file.buffer);
    console.log(`[UPLOAD] job=${jobId} name=${req.file.originalname} size=${req.file.size} bytes`);

    const downloadFileName = toSafeDownloadName(req.file.originalname);

    jobStore.create({
      jobId,
      status: 'processing',
      progress: 5,
      stage: 'converting',
      inputPath,
      outputPath,
      originalName: req.file.originalname.slice(0, 200),
      downloadFileName,
      jobDir,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    console.log(`[CONVERSION_STARTED] job=${jobId}`);

    // Per spec: return processing immediately; conversion runs in background.
    res.status(202).json({ success: true, jobId, status: 'processing' });

    activeConversions += 1;
    try {
      await convertMovToMp4({
        inputPath,
        outputPath,
        onProgress: (pct) => {
          // Map ffmpeg 0-99 -> job 5-95 so UI stages stay truthful.
          const mapped = 5 + Math.round((pct / 100) * 90);
          jobStore.update(jobId, { progress: mapped, stage: 'converting' });
        },
      });

      const exists = await pathExists(outputPath);
      if (!exists) throw new Error('Conversion produced no output file.');

      jobStore.update(jobId, { status: 'completed', progress: 100, stage: 'done' });
      console.log(`[CONVERSION_COMPLETED] job=${jobId}`);

      // Best-effort: remove bulky source file, keep output for download.
      await fs.promises.rm(inputPath, { force: true }).catch(() => undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Conversion failed.';
      jobStore.update(jobId, { status: 'failed', progress: 0, stage: 'failed', error: message });
      console.error(`[CONVERSION_FAILED] job=${jobId} reason=${message}`);
    } finally {
      activeConversions = Math.max(0, activeConversions - 1);
    }
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
    res.json({ success: true, status: 'processing', progress: job.progress });
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
