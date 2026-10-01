import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/utils -> project root backend/
export const backendRoot = path.resolve(here, '..', '..');
export const storageRoot = path.join(backendRoot, 'storage', 'jobs');

export async function ensureStorageRoot(): Promise<void> {
  await fs.promises.mkdir(storageRoot, { recursive: true });
}

export async function ensureJobDir(jobId: string): Promise<string> {
  const jobDir = path.join(storageRoot, jobId);
  await fs.promises.mkdir(jobDir, { recursive: true });
  return jobDir;
}

/** Resolve a path strictly inside the job dir (path-traversal guard). */
export function safeJobPath(jobDir: string, fileName: string): string {
  const resolved = path.resolve(jobDir, fileName);
  const base = path.resolve(jobDir) + path.sep;
  if (!resolved.startsWith(base)) {
    throw new Error('Invalid file path');
  }
  return resolved;
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function removeDirRecursive(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true });
}

/** Sanitize original filename for a safe download name (no paths, safe chars). */
export function toSafeDownloadName(originalName: string): string {
  const base = path.basename(originalName || 'video').replace(/\.[^.]*$/, '').trim();
  const cleaned = base.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 80) || 'converted-video';
  return `${cleaned}.mp4`;
}
