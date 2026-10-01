export type JobStatus =
  | 'queued'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired';

export interface ConversionJob {
  jobId: string;
  status: JobStatus;
  /** 0-100. Only set from real FFmpeg progress; otherwise stays at a coarse stage value. */
  progress: number;
  /** Current human-readable stage: queued | uploading | converting | finalizing */
  stage: 'queued' | 'uploading' | 'converting' | 'finalizing' | 'done' | 'failed';
  inputPath: string;
  outputPath: string;
  originalName: string;
  /** Sanitized download filename, e.g. "my-video.mp4" */
  downloadFileName: string;
  jobDir: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
  durationSeconds?: number;
}
