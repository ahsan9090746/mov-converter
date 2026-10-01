'use client';

export type ConvertStage = 'uploading' | 'converting' | 'finalizing';

const STEPS: { key: ConvertStage; label: string }[] = [
  { key: 'uploading', label: 'Upload' },
  { key: 'converting', label: 'Convert' },
  { key: 'finalizing', label: 'Finish' },
];

const STATUS_COPY: Record<ConvertStage, string> = {
  uploading: 'Uploading your video securely…',
  converting: 'Re-encoding to MP4 (H.264 + AAC)…',
  finalizing: 'Finalizing your MP4…',
};

export function ConversionProgress({ stage, progress }: { stage: ConvertStage; progress: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const activeIndex = STEPS.findIndex((s) => s.key === stage);

  return (
    <div
      className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5"
      role="status"
      aria-live="polite"
      aria-label={`Conversion status: ${STATUS_COPY[stage]} ${pct} percent complete`}
    >
      <ol aria-hidden="true" className="flex items-center gap-1.5">
        {STEPS.map((s, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <li key={s.key} className="flex flex-1 items-center gap-1.5 last:flex-none">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                  done
                    ? 'bg-emerald-500 text-white'
                    : active
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className={`hidden text-xs font-semibold sm:inline ${active ? 'text-blue-700' : done ? 'text-emerald-600' : 'text-slate-400'}`}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <span className={`mx-1 h-px flex-1 ${i < activeIndex ? 'bg-emerald-300' : 'bg-slate-200'}`} />
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="font-semibold tracking-tight">{STATUS_COPY[stage]}</span>
        <span className="font-bold tabular-nums text-blue-700">{pct}%</span>
      </div>
      <div
        className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="progress-sheen h-full rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-blue-600 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-slate-400">
        Keep this tab open while your video converts — larger files take longer.
      </p>
    </div>
  );
}
