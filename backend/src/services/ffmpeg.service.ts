import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { env } from '../config/env.js';

const require = createRequire(import.meta.url);

let resolvedFfmpegPath: string | null = null;

function candidatePaths(): string[] {
  const candidates: string[] = [];
  if (env.ffmpegPath) candidates.push(env.ffmpegPath);
  try {
    // ffmpeg-static exports the binary path as a string.
    const mod = require('ffmpeg-static') as unknown;
    const p = typeof mod === 'string' ? mod : (mod as { default?: string }).default;
    if (p) candidates.push(p);
  } catch {
    // ignore — fall through to system ffmpeg
  }
  candidates.push('ffmpeg');
  return candidates;
}

/** Resolve a working ffmpeg binary. Prefers FFMPEG_PATH, then ffmpeg-static, then system PATH. */
export function resolveFfmpegPath(): string {
  if (resolvedFfmpegPath) return resolvedFfmpegPath;
  for (const candidate of candidatePaths()) {
    try {
      // Absolute paths: check file exists; bare 'ffmpeg': probe with -version.
      if (candidate.includes('/') || candidate.includes('\\')) {
        if (!fs.existsSync(candidate)) continue;
      }
      const probe = spawnSync(candidate, ['-version'], { stdio: 'ignore', timeout: 10000 });
      if (probe.status === 0) {
        resolvedFfmpegPath = candidate;
        return candidate;
      }
    } catch {
      continue;
    }
  }
  throw new Error('FFmpeg binary not found. Install FFmpeg or set FFMPEG_PATH.');
}

/** Verify FFmpeg availability at startup; logs version, throws with actionable message if missing. */
export function verifyFfmpegOrThrow(): string {
  try {
    const bin = resolveFfmpegPath();
    console.log(`[FFMPEG] Using binary: ${bin.includes('node_modules') ? '<bundled ffmpeg-static>' : bin}`);
    return bin;
  } catch {
    console.error(
      '[FFMPEG] FFmpeg not found. Install it (Windows: winget/choco + ffmpeg-static fallback; Linux/Render: ffmpeg-static npm package is bundled, or apt install ffmpeg) or set FFMPEG_PATH.'
    );
    throw new Error('FFmpeg is not available on this server.');
  }
}

export interface ConvertOptions {
  inputPath: string;
  outputPath: string;
  /** Total input duration in seconds (if known) for real progress %. Undefined = indeterminate. */
  durationSeconds?: number;
  onProgress?: (percent: number) => void;
  /** Abort signal support (future use). */
  timeoutMs?: number;
}

function parseDurationSeconds(ffmpegStderrChunk: string): number | undefined {
  // Matches "Duration: 00:01:23.45"
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(ffmpegStderrChunk);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(m[3]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(s)) return undefined;
  return h * 3600 + min * 60 + s;
}

function parseTimeSeconds(ffmpegStderrChunk: string): number | undefined {
  // Matches "time=00:00:31.20" (last occurrence in chunk)
  const re = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g;
  let last: number | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ffmpegStderrChunk)) !== null) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    const s = Number(m[3]);
    if (Number.isFinite(h) && Number.isFinite(min) && Number.isFinite(s)) {
      last = h * 3600 + min * 60 + s;
    }
  }
  return last;
}

/**
 * Convert MOV -> MP4 with broadly compatible settings (H.264 + AAC, faststart).
 * Uses spawn with an argument array — never a shell string — to prevent injection.
 */
export function convertMovToMp4(options: ConvertOptions): Promise<void> {
  const { inputPath, outputPath, onProgress, timeoutMs = 30 * 60 * 1000 } = options;
  const ffmpegBin = resolveFfmpegPath();

  const args = [
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  ];

  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let durationSeconds = options.durationSeconds;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch { /* noop */ }
      reject(new Error('Conversion timed out. Try a shorter video.'));
    }, timeoutMs);
    timer.unref?.();

    let stderrBuf = '';

    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString('utf8');
      stderrBuf += chunk;
      if (stderrBuf.length > 200_000) stderrBuf = stderrBuf.slice(-200_000);

      if (durationSeconds === undefined) {
        const d = parseDurationSeconds(chunk);
        if (d !== undefined && d > 0) durationSeconds = d;
      }
      if (durationSeconds !== undefined && durationSeconds > 0 && onProgress) {
        const t = parseTimeSeconds(chunk);
        if (t !== undefined) {
          const pct = Math.max(0, Math.min(99, Math.floor((t / durationSeconds) * 100)));
          onProgress(pct);
        }
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to start conversion engine: ${err.message}`));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        // Keep internal details server-side; return a generic user-safe message.
        console.error(`[CONVERSION_FAILED] ffmpeg exited with code ${code}. Tail: ${stderrBuf.slice(-2000)}`);
        reject(new Error('Video conversion failed. The file may be corrupt or use an unsupported codec.'));
      }
    });
  });
}
