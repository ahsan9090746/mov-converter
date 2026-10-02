import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { env } from '../config/env.js';

const require = createRequire(import.meta.url);

let resolvedFfmpegPath: string | null = null;
let resolvedFfprobePath: string | null = null;

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

export interface StreamInfo {
  videoCodec?: string;
  audioCodec?: string;
  hasAudio: boolean;
}

function resolveFfprobePath(): string {
  if (resolvedFfprobePath) return resolvedFfprobePath;
  const candidates: string[] = [];
  if (env.ffprobePath) candidates.push(env.ffprobePath);
  try {
    // ffprobe-static exports { path: string }.
    const mod = require('ffprobe-static') as unknown;
    const p =
      typeof mod === 'string' ? mod : (mod as { path?: string }).path;
    if (p) candidates.push(p);
  } catch {
    // ignore — fall through to system ffprobe
  }
  candidates.push('ffprobe');
  for (const candidate of candidates) {
    try {
      if (candidate.includes('/') || candidate.includes('\\')) {
        if (!fs.existsSync(candidate)) continue;
      }
      const probe = spawnSync(candidate, ['-version'], { stdio: 'ignore', timeout: 10000 });
      if (probe.status === 0) {
        resolvedFfprobePath = candidate;
        return candidate;
      }
    } catch {
      continue;
    }
  }
  throw new Error('ffprobe binary not found.');
}

/**
 * Probe input streams (video/audio codecs). Returns undefined when probing
 * is unavailable — callers then fall back to the safe transcode path.
 */
export function probeStreams(inputPath: string): StreamInfo | undefined {
  try {
    const bin = resolveFfprobePath();
    const out = spawnSync(
      bin,
      ['-v', 'error', '-show_streams', '-of', 'json', inputPath],
      { encoding: 'utf8', timeout: 30000 }
    );
    if (out.status !== 0) return undefined;
    const parsed = JSON.parse(out.stdout || '{}') as {
      streams?: { codec_type?: string; codec_name?: string }[];
    };
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.find((s) => s.codec_type === 'audio');
    return {
      videoCodec: video?.codec_name?.toLowerCase() || undefined,
      audioCodec: audio?.codec_name?.toLowerCase() || undefined,
      hasAudio: Boolean(audio),
    };
  } catch {
    return undefined;
  }
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
 * Convert MOV -> MP4 with NO visible quality loss + maximum speed.
 *
 * Path selection (fastest first, all lossless where possible):
 *  1. Full remux `-c copy` when video=h264 + audio=aac/none → instant,
 *     bit-identical quality, no re-encode at all.
 *  2. Video-copy when video already h264 (only audio needs AAC) →
 *     video stream untouched (zero loss), only audio re-encoded at 192k.
 *  3. Audio-copy when audio already aac (only video needs H.264) →
 *     audio untouched, video encoded once at CRF 18 veryfast.
 *  4. Full transcode otherwise → H.264 CRF 18 veryfast + AAC 192k.
 *
 * CRF 18 + preset veryfast is the "best of the best" balance: visually
 * lossless (unlike the old CRF 26 ultrafast which visibly degraded),
 * yet 3-5x faster than slow presets. yuv420p + faststart keep playback
 * universal. Argument arrays only — never a shell string.
 */
export async function convertMovToMp4(options: ConvertOptions): Promise<void> {
  const { inputPath, outputPath, onProgress, timeoutMs = 30 * 60 * 1000 } = options;
  const ffmpegBin = resolveFfmpegPath();
  const preset = env.videoPreset || 'veryfast';
  const crf = String(env.videoCrf || 18);
  const audioBr = env.audioBitrate || '192k';

  const faststart = ['-movflags', '+faststart'];
  const remuxArgs = ['-y', '-i', inputPath, '-c', 'copy', ...faststart, outputPath];

  // Video already perfect — keep every video bit, just fix audio.
  const videoCopyArgs = [
    '-y',
    '-i', inputPath,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', audioBr,
    '-ar', '48000',
    ...faststart,
    outputPath,
  ];

  // Audio already perfect — keep every audio bit, encode video once at top quality.
  const audioCopyArgs = [
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', crf,
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'high',
    '-c:a', 'copy',
    ...faststart,
    outputPath,
  ];

  const transcodeArgs = [
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', crf,
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'high',
    '-c:a', 'aac',
    '-b:a', audioBr,
    '-ar', '48000',
    '-ac', '2',
    ...faststart,
    '-threads', '0',
    outputPath,
  ];

  const info = probeStreams(inputPath);
  const videoH264 = info?.videoCodec === 'h264';
  const audioAac = info?.hasAudio ? info?.audioCodec === 'aac' : true;
  const hasAudio = info?.hasAudio ?? true;

  if (videoH264 && audioAac) {
    console.log(`[REMUX] fast copy path (video=h264 audio=${hasAudio ? info?.audioCodec : 'none'}): ${inputPath}`);
    try {
      await runFfmpeg(ffmpegBin, remuxArgs, options.durationSeconds, onProgress, timeoutMs);
      return;
    } catch (err) {
      console.warn(
        `[REMUX] copy failed (${err instanceof Error ? err.message : err}), falling back to transcode: ${inputPath}`
      );
    }
  } else if (videoH264) {
    // Video is already H.264 — never touch it (zero quality loss), only fix audio. Very fast.
    console.log(
      `[VIDEO_COPY] keep video=h264, encode audio only (${info?.audioCodec ?? 'unknown'}→aac ${audioBr}): ${inputPath}`
    );
    try {
      await runFfmpeg(ffmpegBin, videoCopyArgs, options.durationSeconds, onProgress, timeoutMs);
      return;
    } catch (err) {
      console.warn(
        `[VIDEO_COPY] failed (${err instanceof Error ? err.message : err}), falling back to full transcode: ${inputPath}`
      );
    }
  } else if (audioAac) {
    // Audio is already AAC — copy it untouched, encode video once at CRF 18.
    console.log(
      `[AUDIO_COPY] encode video (crf=${crf} ${preset}) + copy audio=aac: ${inputPath}`
    );
    try {
      await runFfmpeg(ffmpegBin, audioCopyArgs, options.durationSeconds, onProgress, timeoutMs);
      return;
    } catch (err) {
      console.warn(
        `[AUDIO_COPY] failed (${err instanceof Error ? err.message : err}), falling back to full transcode: ${inputPath}`
      );
    }
  } else {
    console.log(
      `[TRANSCODE] high-quality path crf=${crf} ${preset} (video=${info?.videoCodec ?? 'unknown'} audio=${hasAudio ? (info?.audioCodec ?? 'unknown') : 'none'}): ${inputPath}`
    );
  }

  await runFfmpeg(ffmpegBin, transcodeArgs, options.durationSeconds, onProgress, timeoutMs);
}

function runFfmpeg(
  ffmpegBin: string,
  args: string[],
  durationSeconds: number | undefined,
  onProgress: ((percent: number) => void) | undefined,
  timeoutMs: number
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let totalSeconds = durationSeconds;
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

      if (totalSeconds === undefined) {
        const d = parseDurationSeconds(chunk);
        if (d !== undefined && d > 0) totalSeconds = d;
      }
      if (totalSeconds !== undefined && totalSeconds > 0 && onProgress) {
        const t = parseTimeSeconds(chunk);
        if (t !== undefined) {
          const pct = Math.max(0, Math.min(99, Math.floor((t / totalSeconds) * 100)));
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
