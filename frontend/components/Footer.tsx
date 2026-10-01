export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3 sm:px-6">
        <div>
          <p className="text-[15px] font-bold tracking-tight">MovToMP4 Converter</p>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-500">
            Fast, secure MOV to MP4 conversion in your browser. No software to install, no account
            required.
          </p>
          <p className="mt-3 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            H.264 + AAC · Faststart MP4
          </p>
        </div>
        <nav aria-label="Product" className="text-sm">
          <p className="font-semibold text-slate-900">Product</p>
          <ul className="mt-3 space-y-2 text-slate-500">
            <li><a href="#converter" className="hover:text-slate-900">Converter</a></li>
            <li><a href="#features" className="hover:text-slate-900">Features</a></li>
            <li><a href="#how-it-works" className="hover:text-slate-900">How it works</a></li>
            <li><a href="#faq" className="hover:text-slate-900">FAQ</a></li>
          </ul>
        </nav>
        <div className="text-sm">
          <p className="font-semibold text-slate-900">Privacy &amp; security</p>
          <ul className="mt-3 space-y-2 text-slate-500">
            <li>Files auto-delete after download</li>
            <li>Stale files purged within 30 minutes</li>
            <li>Nothing stored permanently</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-100">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-2 px-4 py-5 text-xs text-slate-400 sm:flex-row sm:px-6">
          <p>© {new Date().getFullYear()} MovToMP4 Converter. All rights reserved.</p>
          <p>Converted files are temporary — please keep a backup of your originals.</p>
        </div>
      </div>
    </footer>
  );
}
