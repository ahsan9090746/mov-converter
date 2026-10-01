import type { BatchStatusResponse, ConvertResponse, ServerLimits, StatusResponse } from '../types';

// Central API helper — all requests go through NEXT_PUBLIC_API_URL.
// Never hardcode localhost URLs in components.
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export const FALLBACK_LIMITS: ServerLimits = { maxFileSizeMb: 100, maxFilesPerBatch: 10 };

/** Distinguishes "server said no" from "server unreachable" so the UI
 *  never blames the connection for a CORS/413-style rejection. */
export class ApiError extends Error {
  status?: number;
  isNetworkError: boolean;

  constructor(message: string, opts?: { status?: number; isNetworkError?: boolean }) {
    super(message);
    this.name = 'ApiError';
    this.status = opts?.status;
    this.isNetworkError = opts?.isNetworkError ?? false;
  }
}

export function networkErrorMessage(): string {
  return 'The conversion server could not be reached. On the free tier it sleeps after inactivity and needs about a minute to wake up — please wait a moment and try again.';
}

function apiUrl(path: string): string {
  if (!API_BASE) throw new Error('API is not configured.');
  return `${API_BASE}${path}`;
}

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function friendlyError(body: Record<string, unknown>, fallback: string): string {
  const msg = typeof body.message === 'string' ? body.message : fallback;
  return msg;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function uploadForConversion(
  file: File,
  onUploadProgress?: (percent: number) => void
): Promise<ConvertResponse> {
  const form = new FormData();
  form.append('file', file, file.name);

  // Use XHR for real upload progress (fetch cannot report upload progress).
  // No XHR timeout is set on purpose: large files on a sleepy free-tier
  // server legitimately take a long time.
  return new Promise<ConvertResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/api/convert'));
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onUploadProgress) {
        onUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as Record<string, unknown>;
      if (xhr.status >= 200 && xhr.status < 300 && body.success && typeof body.jobId === 'string') {
        resolve(body as unknown as ConvertResponse);
      } else {
        // Server rejected the upload (400/403/409/413/429/500): show ITS
        // message, never a generic "check your connection".
        reject(new ApiError(friendlyError(body, 'Upload failed. Please try again.'), { status: xhr.status }));
      }
    };
    // Network-level failure (refused/DNS/CORS/offline/sleeping server).
    xhr.onerror = () => reject(new ApiError(networkErrorMessage(), { isNetworkError: true }));
    xhr.ontimeout = () => reject(new ApiError('Upload timed out. Try a smaller file.', { isNetworkError: true }));
    xhr.send(form);
  });
}

/** Upload with retries on network errors only (server rejections throw immediately). */
export async function uploadWithRetry(
  file: File,
  onUploadProgress?: (percent: number) => void,
  maxRetries = 2
): Promise<ConvertResponse> {
  let attempt = 0;
  for (;;) {
    try {
      return await uploadForConversion(file, onUploadProgress);
    } catch (e) {
      const retryable = e instanceof ApiError && e.isNetworkError && attempt < maxRetries;
      if (!retryable) throw e;
      attempt += 1;
      // Backoff: ~2s, then ~5s — gives a waking free-tier server time to boot.
      await sleep(attempt === 1 ? 2000 : 5000);
    }
  }
}

export async function fetchStatus(jobId: string): Promise<StatusResponse> {
  const res = await fetch(apiUrl(`/api/status/${encodeURIComponent(jobId)}`), { cache: 'no-store' });
  const body = await parseJsonSafe(res);
  // Backend returns HTTP 422 with { status: 'failed', message } when conversion fails.
  // Surface that as data (not a throw) so the UI can show the failure state.
  if (body.status === 'failed') {
    return {
      success: false,
      status: 'failed',
      progress: 0,
      message: typeof body.message === 'string' ? body.message : 'Conversion failed.',
    };
  }
  if (res.ok && body.success) return body as unknown as StatusResponse;
  throw new ApiError(friendlyError(body, 'Could not check conversion status.'), { status: res.status });
}

/** Poll many jobs in a single request (used while any batch job is active). */
export async function fetchStatusBatch(jobIds: string[]): Promise<BatchStatusResponse> {
  const res = await fetch(apiUrl('/api/status/batch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobIds }),
    cache: 'no-store',
  });
  const body = await parseJsonSafe(res);
  if (res.ok && body.success && Array.isArray(body.jobs)) {
    return body as unknown as BatchStatusResponse;
  }
  throw new ApiError(friendlyError(body, 'Could not check conversion status.'), { status: res.status });
}

export function downloadUrl(jobId: string): string {
  return apiUrl(`/api/download/${encodeURIComponent(jobId)}`);
}

export function downloadZipUrl(jobIds: string[]): string {
  return apiUrl(`/api/download-zip?ids=${jobIds.map(encodeURIComponent).join(',')}`);
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/api/health'), { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

/** Server-driven limits (max file size, max files per batch). Falls back to
 *  safe defaults when the server is unreachable so validation still works. */
export async function fetchServerLimits(): Promise<ServerLimits> {
  try {
    const res = await fetch(apiUrl('/api/health'), { cache: 'no-store' });
    if (!res.ok) return FALLBACK_LIMITS;
    const body = (await parseJsonSafe(res)) as {
      maxFileSizeMb?: unknown;
      maxFilesPerBatch?: unknown;
    };
    const maxFileSizeMb =
      typeof body.maxFileSizeMb === 'number' && body.maxFileSizeMb > 0
        ? Math.floor(body.maxFileSizeMb)
        : FALLBACK_LIMITS.maxFileSizeMb;
    const maxFilesPerBatch =
      typeof body.maxFilesPerBatch === 'number' && body.maxFilesPerBatch > 0
        ? Math.floor(body.maxFilesPerBatch)
        : FALLBACK_LIMITS.maxFilesPerBatch;
    return { maxFileSizeMb, maxFilesPerBatch };
  } catch {
    return FALLBACK_LIMITS;
  }
}

export { API_BASE };
