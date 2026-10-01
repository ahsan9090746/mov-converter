'use client';

export function ConversionResult({
  downloadHref,
  downloadName,
  fileName,
  onReset,
}: {
  downloadHref: string;
  downloadName: string;
  fileName: string;
  onReset: () => void;
}) {
  return (
    <div
      className="animate-fade-up rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-6 text-center shadow-sm sm:p-8"
      role="status"
    >
      <div
        aria-hidden="true"
        className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md shadow-emerald-200"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <p className="mt-4 text-xl font-bold tracking-tight text-emerald-950">Conversion complete</p>
      <p className="mx-auto mt-1 max-w-sm truncate text-sm text-emerald-800" title={fileName}>
        {fileName} <span aria-hidden="true">→</span> <span className="font-semibold">{downloadName}</span>
      </p>
      <p className="mt-1 text-xs text-emerald-700/70">Compatible MP4 · H.264 video + AAC audio</p>
      <div className="mt-5 flex flex-col justify-center gap-2.5 sm:flex-row">
        <a
          href={downloadHref}
          download={downloadName}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-7 py-3 text-sm font-bold text-white shadow-md shadow-emerald-200 transition hover:bg-emerald-700"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m7 10 5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
          Download MP4
        </a>
        <button
          type="button"
          onClick={onReset}
          className="rounded-xl border border-emerald-300 bg-white px-7 py-3 text-sm font-bold text-emerald-800 transition hover:bg-emerald-100"
        >
          Convert another file
        </button>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
        Your files are deleted from our servers automatically after download.
      </p>
    </div>
  );
}
