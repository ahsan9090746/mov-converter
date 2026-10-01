export type ConverterPhase =
  | 'idle'
  | 'selected'
  | 'uploading'
  | 'converting'
  | 'finalizing'
  | 'done'
  | 'error';

export interface ConvertResponse {
  success: boolean;
  jobId: string;
  status: string;
}

export interface StatusResponse {
  success: boolean;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  downloadUrl?: string;
  message?: string;
}

export interface BatchJobStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'expired';
  progress: number;
  downloadUrl?: string;
  message?: string;
}

export interface BatchStatusResponse {
  success: boolean;
  jobs: BatchJobStatus[];
}

export interface ServerLimits {
  maxFileSizeMb: number;
  maxFilesPerBatch: number;
}
