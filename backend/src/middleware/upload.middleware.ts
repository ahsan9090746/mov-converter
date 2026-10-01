import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env.js';
import { ensureJobDir, storageRoot } from '../utils/files.js';

const MAX_BYTES = env.maxFileSizeMb * 1024 * 1024;

// Only .mov extension + MOV-ish MIME types. Extension alone is not trusted:
// multer fileFilter checks both, and ffprobe/ffmpeg will fail non-video files.
const ALLOWED_EXT = '.mov';
const ALLOWED_MIME = new Set([
  'video/quicktime',
  'video/x-quicktime',
  'video/mov',
  'application/octet-stream', // some browsers send generic type for .mov
]);

function isMovFile(originalName: string, mimetype: string): boolean {
  const ext = path.extname(originalName || '').toLowerCase();
  if (ext !== ALLOWED_EXT) return false;
  // If browser sent a specific video mime, enforce it; allow octet-stream fallback.
  if (mimetype === 'application/octet-stream') return true;
  if (ALLOWED_MIME.has(mimetype.toLowerCase())) return true;
  return false;
}

export interface ConvertRequest extends Request {
  jobId: string;
}

/**
 * Mint a job id BEFORE multer runs so diskStorage can stream the upload
 * straight into storage/jobs/<jobId>/input.mov (no RAM buffering — the
 * 512 MB free tier would be exhausted by memoryStorage on large files).
 */
export async function assignJobId(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const jobId = uuidv4();
    (req as ConvertRequest).jobId = jobId;
    await ensureJobDir(jobId);
    next();
  } catch (err) {
    next(err);
  }
}

const diskStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    cb(null, path.join(storageRoot, (req as ConvertRequest).jobId));
  },
  filename: (_req, _file, cb) => {
    cb(null, 'input.mov');
  },
});

export const uploadSingleMov = multer({
  storage: diskStorage,
  limits: {
    fileSize: MAX_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!isMovFile(file.originalname, file.mimetype)) {
      cb(new Error('ONLY_MOV_ALLOWED'));
      return;
    }
    cb(null, true);
  },
}).single('file');

export { MAX_BYTES };
