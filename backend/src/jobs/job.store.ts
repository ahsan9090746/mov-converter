import type { ConversionJob, JobStatus } from '../types/job.js';

/**
 * In-memory job store for V1 single-instance deployment.
 *
 * NOTE: Suitable for a single Render instance (V1). For multi-instance /
 * autoscaled deployments, replace with Redis or a database-backed store.
 */
class JobStore {
  private jobs = new Map<string, ConversionJob>();

  create(job: ConversionJob): ConversionJob {
    this.jobs.set(job.jobId, job);
    return job;
  }

  get(jobId: string): ConversionJob | undefined {
    return this.jobs.get(jobId);
  }

  update(jobId: string, patch: Partial<Pick<ConversionJob, 'status' | 'progress' | 'stage' | 'error' | 'updatedAt' | 'durationSeconds'>>): ConversionJob | undefined {
    const existing = this.jobs.get(jobId);
    if (!existing) return undefined;
    const updated: ConversionJob = {
      ...existing,
      ...patch,
      updatedAt: Date.now(),
    };
    this.jobs.set(jobId, updated);
    return updated;
  }

  setStatus(jobId: string, status: JobStatus, extra?: Partial<ConversionJob>): void {
    const existing = this.jobs.get(jobId);
    if (!existing) return;
    this.jobs.set(jobId, {
      ...existing,
      ...extra,
      status,
      updatedAt: Date.now(),
    });
  }

  remove(jobId: string): void {
    this.jobs.delete(jobId);
  }

  list(): ConversionJob[] {
    return [...this.jobs.values()];
  }
}

export const jobStore = new JobStore();
