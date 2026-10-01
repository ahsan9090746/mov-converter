import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { jobStore } from '../jobs/job.store.js';
import { removeDirRecursive, storageRoot } from '../utils/files.js';

/** Delete a single job's files and mark expired. Safe to call multiple times. */
export async function deleteJobFiles(jobId: string): Promise<void> {
  const job = jobStore.get(jobId);
  const jobDir = job?.jobDir ?? path.join(storageRoot, jobId);
  try {
    await removeDirRecursive(jobDir);
    console.log(`[CLEANUP] Removed job files: ${jobId}`);
  } catch (err) {
    console.error(`[CLEANUP] Failed to remove ${jobId}:`, err instanceof Error ? err.message : err);
  }
  if (job && (job.status === 'completed' || job.status === 'failed')) {
    jobStore.setStatus(jobId, 'expired');
  }
}

/** Remove jobs older than CLEANUP_AFTER_MINUTES. Runs on an interval. */
export async function cleanupStaleJobs(): Promise<void> {
  const cutoff = Date.now() - env.cleanupAfterMinutes * 60 * 1000;
  const stale = jobStore.list().filter((j) => j.createdAt < cutoff);
  if (stale.length === 0) return;
  console.log(`[CLEANUP] Found ${stale.length} stale job(s)`);
  for (const job of stale) {
    await deleteJobFiles(job.jobId);
    jobStore.remove(job.jobId);
  }
}

/** Sweep orphan directories on disk with no live job record (e.g. after restart). */
export async function sweepOrphanDirs(): Promise<void> {
  try {
    const entries = await fs.promises.readdir(storageRoot, { withFileTypes: true });
    const cutoff = Date.now() - env.cleanupAfterMinutes * 60 * 1000;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const jobId = entry.name;
      if (jobStore.get(jobId)) continue;
      const dir = path.join(storageRoot, jobId);
      try {
        const stat = await fs.promises.stat(dir);
        if (stat.mtimeMs < cutoff) {
          await removeDirRecursive(dir);
          console.log(`[CLEANUP] Removed orphan dir: ${jobId}`);
        }
      } catch {
        // ignore per-entry errors
      }
    }
  } catch {
    // storage root may not exist yet on first boot
  }
}

export function startCleanupScheduler(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  const timer = setInterval(() => {
    cleanupStaleJobs().catch((e) => console.error('[CLEANUP] scheduler error:', e));
    sweepOrphanDirs().catch((e) => console.error('[CLEANUP] sweep error:', e));
  }, intervalMs);
  timer.unref?.();
  return timer;
}
