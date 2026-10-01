export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <a href="/" className="flex items-center gap-2.5" aria-label="MovToMP4 Converter — home">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-sm"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M8 5.5v13l11-6.5-11-6.5Z"
                fill="white"
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="leading-tight">
            <span className="block text-[17px] font-bold tracking-tight">
              MovToMP4
            </span>
            <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
              Online Converter
            </span>
          </span>
        </a>
        <nav aria-label="Primary" className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
          <a href="#converter" className="transition hover:text-slate-950">Converter</a>
          <a href="#features" className="transition hover:text-slate-950">Features</a>
          <a href="#how-it-works" className="transition hover:text-slate-950">How it works</a>
          <a href="#faq" className="transition hover:text-slate-950">FAQ</a>
        </nav>
        <div className="flex items-center gap-2.5">
          <span className="hidden rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 sm:inline-block">
            MOV → MP4
          </span>
          <a
            href="#converter"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
          >
            Convert now
          </a>
        </div>
      </div>
    </header>
  );
}
