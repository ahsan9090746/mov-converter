import multer from 'multer';
import path from 'node:path';
import { env } from '../config/env.js';

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

export const uploadSingleMov = multer({
  storage: multer.memoryStorage(),
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
