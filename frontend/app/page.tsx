'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConversionProgress, type ConvertStage } from '../components/ConversionProgress';
import { ConversionResult } from '../components/ConversionResult';
import { ErrorMessage } from '../components/ErrorMessage';
import { FilePreview } from '../components/FilePreview';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { UploadZone } from '../components/UploadZone';
import { downloadUrl, fetchStatus, uploadForConversion } from '../lib/api';
import type { ConverterPhase } from '../types';

const MAX_POLL_ERRORS = 10;

function stageFromPhase(phase: ConverterPhase): ConvertStage {
  if (phase === 'uploading') return 'uploading';
  if (phase === 'finalizing') return 'finalizing';
  return 'converting';
}

const FEATURES = [
  {
    title: 'True quality conversion',
    body: 'Server-side FFmpeg re-encode to H.264 video with AAC audio — not a renamed container.',
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
    body: 'Up to 500 MB per file by default, with server-side validation on type, size and content.',
  },
  {
    title: 'Live progress',
    body: 'Real upload bytes and real encoder progress — never fabricated percentages.',
  },
];

const FAQS = [
  {
    q: 'Which files can I convert?',
    a: 'Version 1 supports MOV (.mov) files up to 500 MB as input, producing a single MP4 download. Additional formats are planned for later releases.',
  },
  {
    q: 'Will my video lose quality?',
    a: 'The converter uses the H.264 veryfast preset at CRF 23 with AAC 128k audio — a widely used balance of quality and file size suitable for sharing, playback and editing.',
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

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<ConverterPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const pollErrors = useRef(0);

  const busy = phase === 'uploading' || phase === 'converting' || phase === 'finalizing';
  const stepIndex = phase === 'done' ? 3 : busy ? (phase === 'uploading' ? 0 : phase === 'converting' ? 1 : 2) : file ? 1 : 0;

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => stopPolling, []);

  const reset = useCallback(() => {
    stopPolling();
    pollErrors.current = 0;
    setFile(null);
    setPhase('idle');
    setProgress(0);
    setJobId(null);
    setError('');
  }, []);

  function fail(message: string) {
    stopPolling();
    setPhase('error');
    setError(message);
  }

  function pollStatus(id: string) {
    stopPolling();
    pollErrors.current = 0;
    pollRef.current = setInterval(async () => {
      try {
        const s = await fetchStatus(id);
        pollErrors.current = 0;
        if (s.status === 'completed') {
          stopPolling();
          setProgress(100);
          setPhase('done');
        } else if (s.status === 'failed') {
          fail(s.message || 'Conversion failed. The file may be corrupt — please try another file.');
        } else {
          // Backend reports real FFmpeg progress (5–95 while converting).
          const pct = Math.max(0, Math.min(99, s.progress ?? 0));
          setProgress(pct);
          setPhase(pct >= 95 ? 'finalizing' : 'converting');
        }
      } catch (e) {
        if (e instanceof Error && e.message === 'API is not configured.') {
          fail('Converter service is not configured. Please try again later.');
          return;
        }
        // Tolerate transient network blips, but don't spin forever if the
        // backend is gone (restart, expiry, offline).
        pollErrors.current += 1;
        if (pollErrors.current >= MAX_POLL_ERRORS) {
          fail('Lost contact with the conversion server. Please check your connection and try again.');
        }
      }
    }, 1500);
  }

  async function startConversion() {
    if (!file || busy) return;
    setError('');
    setPhase('uploading');
    setProgress(0);
    try {
      const res = await uploadForConversion(file, (pct) => {
        // Upload stage occupies 0–15% of the bar truthfully (bytes sent).
        setProgress(Math.round((pct / 100) * 15));
      });
      setJobId(res.jobId);
      setPhase('converting');
      setProgress(16);
      pollStatus(res.jobId);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Upload failed. Please try again.');
    }
  }

  let downloadHref = '#';
  try {
    downloadHref = jobId ? downloadUrl(jobId) : '#';
  } catch {
    downloadHref = '#';
  }
  const downloadName = file ? file.name.replace(/\.mov$/i, '.mp4') : 'converted-video.mp4';

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
              Upload your MOV file and download a broadly compatible MP4 video — H.264 + AAC,
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
              {/* Stepper */}
              <ol aria-label="Conversion steps" className="mb-5 flex items-center gap-2 text-xs font-semibold">
                {['Upload', 'Convert', 'Download'].map((label, i) => {
                  const done = i < stepIndex;
                  const active = i === stepIndex && phase !== 'done';
                  return (
                    <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-full ${
                          done || (phase === 'done' && i === 2)
                            ? 'bg-emerald-500 text-white'
                            : active
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        {done || (phase === 'done' && i === 2) ? (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        ) : (
                          i + 1
                        )}
                      </span>
                      <span className={active ? 'text-slate-900' : 'text-slate-400'}>{label}</span>
                      {i < 2 && <span aria-hidden="true" className="mx-1 h-px flex-1 bg-slate-200" />}
                    </li>
                  );
                })}
              </ol>

              <div className="space-y-4">
                {error && <ErrorMessage message={error} onDismiss={() => setError('')} />}

                {phase === 'done' && jobId ? (
                  <ConversionResult
                    downloadHref={downloadHref}
                    downloadName={downloadName}
                    fileName={file?.name ?? 'Your video'}
                    onReset={reset}
                  />
                ) : (
                  <>
                    {!file ? (
                      <UploadZone
                        disabled={busy}
                        onError={setError}
                        onFileChosen={(f) => {
                          setFile(f);
                          setError('');
                          setPhase('selected');
                        }}
                      />
                    ) : (
                      <FilePreview file={file} disabled={busy} onRemove={() => !busy && reset()} />
                    )}

                    {busy && <ConversionProgress stage={stageFromPhase(phase)} progress={progress} />}

                    {phase === 'error' && (
                      <button
                        type="button"
                        onClick={reset}
                        className="w-full rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold transition hover:bg-slate-50"
                      >
                        Start over
                      </button>
                    )}

                    {file && (phase === 'selected' || phase === 'error') && (
                      <button
                        type="button"
                        onClick={startConversion}
                        disabled={busy}
                        className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3.5 text-[15px] font-bold text-white shadow-md shadow-blue-200 transition hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
                      >
                        Convert to MP4
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                          <path d="M5 12h14" />
                          <path d="m13 6 6 6-6 6" />
                        </svg>
                      </button>
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
                    ['Input', '.MOV up to 500 MB'],
                    ['Output', '.MP4 · H.264 + AAC'],
                    ['Quality', 'CRF 23 · 128k audio'],
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
              ['Upload your MOV', 'Drag & drop or browse. Your file is validated and transferred securely.'],
              ['We convert it', 'Our servers re-encode it to MP4 with H.264 video and AAC audio.'],
              ['Download MP4', 'Grab your file instantly. Everything is deleted afterwards.'],
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
              Convert a MOV file now
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
