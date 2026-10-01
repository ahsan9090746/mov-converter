import type { ConvertResponse, StatusResponse } from '../types';

// Central API helper — all requests go through NEXT_PUBLIC_API_URL.
// Never hardcode localhost URLs in components.
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

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

export async function uploadForConversion(
  file: File,
  onUploadProgress?: (percent: number) => void
): Promise<ConvertResponse> {
  const form = new FormData();
  form.append('file', file, file.name);

  // Use XHR for real upload progress (fetch cannot report upload progress).
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
        reject(new Error(friendlyError(body, 'Upload failed. Please try again.')));
      }
    };
    xhr.onerror = () => reject(new Error('Could not reach the conversion server. Check your connection.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out. Try a smaller file.'));
    xhr.send(form);
  });
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
  throw new Error(friendlyError(body, 'Could not check conversion status.'));
}

export function downloadUrl(jobId: string): string {
  return apiUrl(`/api/download/${encodeURIComponent(jobId)}`);
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/api/health'), { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export { API_BASE };
