'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorMessage } from '../components/ErrorMessage';
import { formatBytes } from '../components/FilePreview';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { UploadZone } from '../components/UploadZone';
import {
  ApiError,
  FALLBACK_LIMITS,
  checkHealth,
  downloadUrl,
  downloadZipUrl,
  fetchServerLimits,
  fetchStatusBatch,
  uploadWithRetry,
} from '../lib/api';
import type { ServerLimits } from '../types';

type ItemStage = 'idle' | 'uploading' | 'queued' | 'converting' | 'done' | 'failed';

interface BatchItem {
  key: string;
  file: File;
  stage: ItemStage;
  uploadPct: number;
  convertPct: number;
  jobId: string | null;
  error: string;
}

const MAX_POLL_ERRORS = 10;
const UPLOAD_PARALLELISM = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STAGE_LABEL: Record<ItemStage, string> = {
  idle: 'Ready',
  uploading: 'Uploading',
  queued: 'Queued',
  converting: 'Converting',
  done: 'Done',
  failed: 'Failed',
};

export default function HomePage() {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [limits, setLimits] = useState<ServerLimits>(FALLBACK_LIMITS);
  const [server, setServer] = useState<'checking' | 'ready' | 'waking' | 'down'>('checking');
  const [globalError, setGlobalError] = useState('');
  const [starting, setStarting] = useState(false);

  const itemsRef = useRef<BatchItem[]>([]);
  itemsRef.current = items;
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const pollErrors = useRef(0);
  const keySeq = useRef(0);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => stopPolling, []);

  // Wake the free-tier server on page load; show a banner while it boots.
  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    async function wake() {
      setServer('checking');
      for (;;) {
        const ok = await checkHealth();
        if (cancelled) return;
        if (ok) {
          const lim = await fetchServerLimits();
          if (cancelled) return;
          setLimits(lim);
          setServer('ready');
          return;
        }
        if (Date.now() - startedAt > 3000) setServer('waking');
        if (Date.now() - startedAt > 120000) {
          setServer('down');
          return;
        }
        await sleep(5000);
      }
    }
    void wake();
    return () => {
      cancelled = true;
    };
  }, []);

  async function waitForHealthy(timeoutMs: number): Promise<boolean> {
    const startedAt = Date.now();
    for (;;) {
      if (await checkHealth()) return true;
      if (Date.now() - startedAt > timeoutMs) return false;
      await sleep(3000);
    }
  }

  function patchItem(key: string, patch: Partial<BatchItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  const addFiles = useCallback(
    (files: File[]) => {
      setGlobalError('');
      setItems((prev) => {
        const room = limits.maxFilesPerBatch - prev.length;
        if (room <= 0) {
          setGlobalError(`Batch is full — maximum ${limits.maxFilesPerBatch} files per batch. Remove one to add more.`);
          return prev;
        }
        const accepted = files.slice(0, room);
        if (files.length > room) {
          setGlobalError(`Only ${room} more file(s) fit — maximum ${limits.maxFilesPerBatch} per batch.`);
        }
        const next: BatchItem[] = accepted.map((file) => {
          keySeq.current += 1;
          return {
            key: `file-${Date.now()}-${keySeq.current}`,
            file,
            stage: 'idle' as const,
            uploadPct: 0,
            convertPct: 0,
            jobId: null,
            error: '',
          };
        });
        return [...prev, ...next];
      });
    },
    [limits.maxFilesPerBatch]
  );

  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  function clearFinished() {
    setItems((prev) => prev.filter((it) => it.stage !== 'done' && it.stage !== 'failed'));
    setGlobalError('');
  }

  async function uploadKeys(keys: string[]) {
    const queue = [...keys];
    const workers = Array.from(
      { length: Math.min(UPLOAD_PARALLELISM, queue.length) },
      async () => {
        while (queue.length > 0) {
          const key = queue.shift() as string;
          const file = itemsRef.current.find((i) => i.key === key)?.file;
          if (!file) continue;
          patchItem(key, { stage: 'uploading', uploadPct: 0, convertPct: 0, error: '' });
          try {
            const res = await uploadWithRetry(file, (pct) => patchItem(key, { uploadPct: pct }));
            patchItem(key, {
              stage: res.status === 'queued' ? 'queued' : 'converting',
              convertPct: res.status === 'queued' ? 0 : 5,
              jobId: res.jobId,
            });
          } catch (e) {
            patchItem(key, {
              stage: 'failed',
              error: e instanceof Error ? e.message : 'Upload failed. Please try again.',
            });
          }
        }
      }
    );
    await Promise.all(workers);
  }

  async function startConversion() {
    const keys = itemsRef.current
      .filter((it) => it.stage === 'idle' || it.stage === 'failed')
      .map((it) => it.key);
    if (keys.length === 0 || starting) return;
    setStarting(true);
    setGlobalError('');
    // Reset retried items to a clean idle state first.
    setItems((prev) =>
      prev.map((it) =>
        it.stage === 'failed' ? { ...it, stage: 'idle', error: '', jobId: null, uploadPct: 0, convertPct: 0 } : it
      )
    );
    try {
      const healthy = await waitForHealthy(90000);
      if (!healthy) {
        setGlobalError('The conversion server is still unreachable. It may be waking up — please wait a minute and try again.');
        return;
      }
      // Upload starts immediately once the server answers; up to 2 in parallel.
      await uploadKeys(keys);
    } finally {
      setStarting(false);
    }
  }

  async function retryItem(key: string) {
    if (starting) return;
    patchItem(key, { stage: 'idle', error: '', jobId: null, uploadPct: 0, convertPct: 0 });
    setStarting(true);
    try {
      const healthy = await waitForHealthy(90000);
      if (!healthy) {
        patchItem(key, { stage: 'failed', error: 'The conversion server is still unreachable. Please try again in a minute.' });
        return;
      }
      await uploadKeys([key]);
    } finally {
      setStarting(false);
    }
  }

  // Batch polling: one request for all active jobs, every 2s, while any job is live.
  const activeKey = items
    .filter((it) => it.jobId && (it.stage === 'converting' || it.stage === 'queued'))
    .map((it) => it.jobId as string)
    .sort()
    .join(',');
  useEffect(() => {
    if (!activeKey) {
      stopPolling();
      return;
    }
    if (pollRef.current) return; // already polling; each tick re-reads live ids
    pollErrors.current = 0;
    pollRef.current = setInterval(async () => {
      const ids = itemsRef.current
        .filter((it) => it.jobId && (it.stage === 'converting' || it.stage === 'queued'))
        .map((it) => it.jobId as string);
      if (ids.length === 0) {
        stopPolling();
        return;
      }
      try {
        const batch = await fetchStatusBatch(ids);
        pollErrors.current = 0;
        setItems((prev) =>
          prev.map((it) => {
            if (!it.jobId) return it;
            const s = batch.jobs.find((j) => j.jobId === it.jobId);
            if (!s) return it;
            if (s.status === 'completed') return { ...it, stage: 'done' as const, convertPct: 100, error: '' };
            if (s.status === 'failed') {
              return { ...it, stage: 'failed' as const, convertPct: 0, error: s.message || 'Conversion failed. The file may be corrupt — please try another file.' };
            }
            if (s.status === 'expired') {
              return { ...it, stage: 'failed' as const, convertPct: 0, error: 'Job expired on the server. Please upload again.' };
            }
            if (s.status === 'queued') return { ...it, stage: 'queued' as const, convertPct: 0 };
            const pct = Math.max(0, Math.min(99, s.progress ?? 0));
            return { ...it, stage: 'converting' as const, convertPct: pct };
          })
        );
      } catch (e) {
        if (e instanceof ApiError && !e.isNetworkError) return; // malformed ids — nothing to poll
        pollErrors.current += 1;
        if (pollErrors.current >= MAX_POLL_ERRORS) {
          stopPolling();
          setGlobalError('Lost contact with the conversion server. Your uploads may still finish — wait a moment, then retry.');
        }
      }
    }, 2000);
    // Keep polling across id-set changes; stopped when no job is active or on unmount.
  }, [activeKey]);

  const pendingCount = items.filter((it) => it.stage === 'idle' || it.stage === 'failed').length;
  const activeCount = items.filter((it) => it.stage === 'uploading' || it.stage === 'converting' || it.stage === 'queued').length;
  const doneItems = items.filter((it) => it.stage === 'done' && it.jobId);
  const busy = starting || activeCount > 0;
  const maxMb = limits.maxFileSizeMb;

  const FEATURES = [
    {
      title: 'True quality conversion',
      body: 'Server-side FFmpeg to H.264 video with AAC audio — not a renamed container.',
    },
    {
      title: 'Plays everywhere',
      body: 'Faststart MP4 output works on iPhone, Android, Windows, macOS, YouTube and all major editors.',
    },
    {
      title: 'Private by design',
      body: 'Uploads live in temporary storage only and are wiped after download or within minutes.',
    },
    {
      title: 'No signup, no watermark',
      body: 'Convert anonymously with zero branding baked into your video. What you upload is what you get.',
    },
    {
      title: 'Large files welcome',
      body: `Up to ${maxMb} MB per file, with server-side validation on type, size and content.`,
    },
    {
      title: 'Bulk conversion',
      body: `Convert up to ${limits.maxFilesPerBatch} MOV files in one batch, then download them one by one or all as a ZIP.`,
    },
  ];

  const FAQS = [
    {
      q: 'Which files can I convert?',
      a: `MOV (.mov) files up to ${maxMb} MB each, up to ${limits.maxFilesPerBatch} files per batch, producing MP4 downloads. Additional formats are planned for later releases.`,
    },
    {
      q: 'Will my video lose quality?',
      a: 'Compatible files are remuxed without re-encoding (no quality change at all); others use a fast H.264 preset with AAC 128k audio — a widely used balance of speed, quality and file size.',
    },
    {
      q: 'Are my files stored permanently?',
      a: 'No. Both the original upload and the converted file live in temporary server storage. They are deleted automatically shortly after you download, or within about 30 minutes if abandoned.',
    },
    {
      q: 'Do I need an account?',
      a: 'No account, no email, no watermark. Open the page, convert, download — that is the entire flow.',
    },
    {
      q: 'Why did my conversion fail?',
      a: 'Most failures come from corrupt, truncated, or DRM-protected files, or codecs FFmpeg cannot decode. Try exporting the MOV again from your editor and re-uploading.',
    },
  ];

  return (
    <>
      <Header />
      <main>
        {/* ── Hero ─────────────────────────────────────────── */}
        <section aria-labelledby="main-heading" className="relative overflow-hidden bg-white">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-72 max-w-3xl rounded-full bg-gradient-to-r from-blue-100 via-indigo-100 to-emerald-100 blur-3xl"
          />
          <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-12 text-center sm:px-6 sm:pt-16">
            <p className="mx-auto inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white shadow-sm">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Free online converter · No signup · No watermark
            </p>
            <h1
              id="main-heading"
              className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl"
            >
              Convert{' '}
              <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                MOV to MP4
              </span>{' '}
              Online
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-[17px] leading-relaxed text-slate-600">
              Upload your MOV files and download broadly compatible MP4 videos — H.264 + AAC,
              ready for every phone, editor and platform.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs font-semibold text-slate-500">
              {['iPhone & Android', 'YouTube ready', 'Secure upload', 'Auto-deleted files'].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {t}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Converter ────────────────────────────────────── */}
        <section id="converter" aria-label="File converter" className="mx-auto max-w-6xl scroll-mt-20 px-4 sm:px-6">
          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.15)] sm:p-6">
              <div className="space-y-4">
                {server === 'waking' && (
                  <div role="status" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm shadow-sm">
                    <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                        <path d="M12 7v6" />
                        <path d="M12 17.5h.01" />
                      </svg>
                    </span>
                    <div>
                      <p className="font-bold text-amber-900">Waking up the server…</p>
                      <p className="mt-0.5 leading-relaxed text-amber-800">
                        The free server sleeps after inactivity — this can take up to a minute. You can already add files; converting starts automatically once it answers.
                      </p>
                    </div>
                  </div>
                )}
                {server === 'down' && (
                  <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm shadow-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-red-900">Server unreachable</p>
                      <p className="mt-0.5 leading-relaxed text-red-800">
                        The conversion server is not answering. Please check your connection and reload the page in a minute.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      className="shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-bold text-red-700 transition hover:bg-red-100"
                    >
                      Reload
                    </button>
                  </div>
                )}
                {globalError && <ErrorMessage message={globalError} onDismiss={() => setGlobalError('')} />}

                {items.length === 0 ? (
                  <UploadZone
                    disabled={busy}
                    onError={setGlobalError}
                    onFilesChosen={addFiles}
                    maxFiles={limits.maxFilesPerBatch}
                    maxBytes={maxMb * 1024 * 1024}
                  />
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <p className="font-bold tracking-tight">
                        {items.length} file{items.length === 1 ? '' : 's'}
                        {activeCount > 0 && <span className="ml-2 font-semibold text-blue-700">{activeCount} working…</span>}
                        {doneItems.length > 0 && <span className="ml-2 font-semibold text-emerald-600">{doneItems.length} done</span>}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={clearFinished}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-slate-50"
                        >
                          Clear finished
                        </button>
                        {doneItems.length > 0 && (
                          <a
                            href={downloadZipUrl(doneItems.map((it) => it.jobId as string))}
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-slate-700"
                          >
                            Download all as ZIP
                          </a>
                        )}
                      </div>
                    </div>

                    <ul className="space-y-3">
                      {items.map((it) => {
                        const pct = it.stage === 'uploading' ? it.uploadPct : it.stage === 'converting' || it.stage === 'queued' ? it.convertPct : it.stage === 'done' ? 100 : 0;
                        const stateColor =
                          it.stage === 'done'
                            ? 'bg-emerald-500'
                            : it.stage === 'failed'
                              ? 'bg-red-500'
                              : it.stage === 'idle'
                                ? 'bg-slate-300'
                                : 'bg-blue-600';
                        return (
                          <li key={it.key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[15px] font-semibold tracking-tight" title={it.file.name}>
                                  {it.file.name}
                                </p>
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold tabular-nums text-slate-600">
                                    {formatBytes(it.file.size)}
                                  </span>
                                  <span
                                    className={`rounded-md px-2 py-0.5 font-bold ${
                                      it.stage === 'done'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : it.stage === 'failed'
                                          ? 'bg-red-100 text-red-700'
                                          : it.stage === 'idle'
                                            ? 'bg-slate-100 text-slate-500'
                                            : 'bg-blue-100 text-blue-700'
                                    }`}
                                  >
                                    {it.stage === 'converting' && it.convertPct >= 95 ? 'Finalizing' : STAGE_LABEL[it.stage]}
                                    {(it.stage === 'uploading' || it.stage === 'converting') && (
                                      <span className="ml-1 tabular-nums">{Math.round(pct)}%</span>
                                    )}
                                  </span>
                                </div>
                              </div>
                              <div className="flex shrink-0 gap-2">
                                {it.stage === 'done' && it.jobId && (
                                  <a
                                    href={downloadUrl(it.jobId)}
                                    download={`${it.file.name.replace(/\.mov$/i, '')}.mp4`}
                                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700"
                                  >
                                    Download MP4
                                  </a>
                                )}
                                {it.stage === 'failed' && (
                                  <button
                                    type="button"
                                    onClick={() => void retryItem(it.key)}
                                    disabled={busy}
                                    className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 transition hover:bg-blue-50 disabled:opacity-50"
                                  >
                                    Retry
                                  </button>
                                )}
                                {(it.stage === 'idle' || it.stage === 'failed' || it.stage === 'done') && (
                                  <button
                                    type="button"
                                    onClick={() => removeItem(it.key)}
                                    aria-label={`Remove ${it.file.name}`}
                                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            </div>
                            {(it.stage === 'uploading' || it.stage === 'converting' || it.stage === 'queued') && (
                              <div
                                className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100"
                                role="progressbar"
                                aria-valuenow={Math.round(pct)}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={`${it.stage} ${it.file.name}`}
                              >
                                <div className={`h-full rounded-full transition-all duration-500 ${stateColor}`} style={{ width: `${Math.round(pct)}%` }} />
                              </div>
                            )}
                            {it.stage === 'queued' && (
                              <p className="mt-2 text-xs text-slate-500">Waiting for a free conversion slot…</p>
                            )}
                            {it.stage === 'failed' && it.error && (
                              <p className="mt-2 text-xs leading-relaxed text-red-700" role="alert">{it.error}</p>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    {items.length < limits.maxFilesPerBatch && !busy && (
                      <UploadZone
                        disabled={busy}
                        onError={setGlobalError}
                        onFilesChosen={addFiles}
                        maxFiles={limits.maxFilesPerBatch}
                        maxBytes={maxMb * 1024 * 1024}
                      />
                    )}

                    {pendingCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void startConversion()}
                        disabled={busy || server === 'down'}
                        className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3.5 text-[15px] font-bold text-white shadow-md shadow-blue-200 transition hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
                      >
                        {starting ? 'Starting…' : `Convert all (${pendingCount})`}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                          <path d="M5 12h14" />
                          <path d="m13 6 6 6-6 6" />
                        </svg>
                      </button>
                    )}
                    {server === 'waking' && pendingCount > 0 && (
                      <p className="text-center text-xs text-slate-500">Converting starts automatically once the server wakes up.</p>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Aside */}
            <aside className="space-y-4">
              <div className="rounded-3xl bg-slate-900 p-6 text-white shadow-md">
                <p className="text-sm font-bold uppercase tracking-[0.12em] text-blue-300">Why MP4?</p>
                <p className="mt-2 text-[15px] leading-relaxed text-slate-200">
                  MOV files from iPhones and cameras often refuse to play on Windows, Android or
                  the web. MP4 with H.264 plays virtually everywhere.
                </p>
                <dl className="mt-4 space-y-2.5 border-t border-white/10 pt-4 text-sm">
                  {[
                    ['Input', `.MOV up to ${maxMb} MB`],
                    ['Output', '.MP4 · H.264 + AAC'],
                    ['Batch', `Up to ${limits.maxFilesPerBatch} files + ZIP`],
                    ['Cost', 'Free · no account'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3">
                      <dt className="text-slate-400">{k}</dt>
                      <dd className="text-right font-semibold">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-sm font-bold tracking-tight">Your privacy, guaranteed</p>
                <ul className="mt-3 space-y-2.5 text-sm text-slate-600">
                  {[
                    'Encrypted transfer to our servers',
                    'Files never shared or reused',
                    'Deleted right after download',
                    'Abandoned files purged in ~30 min',
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────── */}
        <section id="features" aria-labelledby="features-heading" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-16 sm:px-6">
          <p className="text-center text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Features</p>
          <h2 id="features-heading" className="mt-2 text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
            A converter that does one thing perfectly
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article key={f.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
                <h3 className="font-bold tracking-tight">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────── */}
        <section id="how-it-works" aria-labelledby="how-heading" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-16 sm:px-6">
          <p className="text-center text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Process</p>
          <h2 id="how-heading" className="mt-2 text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
            Three steps, under a minute
          </h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              ['Upload your MOVs', 'Drag & drop or browse up to 10 files at once. Each file is validated and transferred securely.'],
              ['We convert them', 'Our servers remux or re-encode them to MP4 with H.264 video and AAC audio.'],
              ['Download MP4s', 'Grab files one by one or all as a ZIP. Everything is deleted afterwards.'],
            ].map(([t, d], i) => (
              <li key={t} className="relative rounded-2xl border border-slate-200 bg-white p-6 pt-7 shadow-sm">
                <span aria-hidden="true" className="absolute -top-4 left-6 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white shadow">
                  {i + 1}
                </span>
                <p className="font-bold tracking-tight">{t}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── FAQ ──────────────────────────────────────────── */}
        <section id="faq" aria-labelledby="faq-heading" className="mx-auto max-w-3xl scroll-mt-20 px-4 pt-16 sm:px-6">
          <p className="text-center text-xs font-bold uppercase tracking-[0.16em] text-blue-600">FAQ</p>
          <h2 id="faq-heading" className="mt-2 text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
            Questions, answered
          </h2>
          <div className="mt-8 space-y-3">
            {FAQS.map((f) => (
              <details key={f.q} className="group rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm open:shadow-md">
                <summary className="cursor-pointer list-none font-semibold tracking-tight marker:hidden [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center justify-between gap-3">
                    {f.q}
                    <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition group-open:rotate-45 group-open:bg-blue-600 group-open:text-white">
                      +
                    </span>
                  </span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── CTA band ─────────────────────────────────────── */}
        <section aria-label="Get started" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl bg-slate-900 px-6 py-12 text-center text-white shadow-lg sm:px-12">
            <div aria-hidden="true" className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-blue-600/30 blur-3xl" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -right-16 h-64 w-64 rounded-full bg-indigo-500/30 blur-3xl" />
            <h2 className="relative text-2xl font-extrabold tracking-tight sm:text-3xl">
              Your MP4 is one upload away
            </h2>
            <p className="relative mx-auto mt-2 max-w-xl text-slate-300">
              Free, secure and instant. Convert your first video in under a minute.
            </p>
            <a
              href="#converter"
              className="relative mt-6 inline-block rounded-xl bg-white px-8 py-3 text-sm font-bold text-slate-900 shadow transition hover:bg-blue-50"
            >
              Convert MOV files now
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
