'use client';

export function ErrorMessage({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="animate-fade-up flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm shadow-sm"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500 text-white"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M12 7v6" />
          <path d="M12 17.5h.01" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-red-900">Something went wrong</p>
        <p className="mt-0.5 leading-relaxed text-red-800">{message}</p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="shrink-0 rounded-lg px-2 py-1 font-bold text-red-500 transition hover:bg-red-100 hover:text-red-700"
        >
          ✕
        </button>
      )}
    </div>
  );
}
