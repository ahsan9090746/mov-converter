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
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  downloadUrl?: string;
  message?: string;
}
