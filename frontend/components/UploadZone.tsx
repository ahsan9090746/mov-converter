'use client';

import { useRef, useState } from 'react';

interface Props {
  onFilesChosen: (files: File[]) => void;
  onError: (message: string) => void;
  disabled?: boolean;
  /** Maximum files accepted per batch (server-driven). */
  maxFiles: number;
  /** Maximum bytes per file (server-driven). */
  maxBytes: number;
}

const ALLOWED_MIME = new Set(['video/quicktime', 'video/x-quicktime', 'video/mov', 'application/octet-stream']);

function isValidMov(file: File): boolean {
  const extOk = file.name.toLowerCase().endsWith('.mov');
  const mimeOk = file.type === '' || ALLOWED_MIME.has(file.type.toLowerCase());
  return extOk && mimeOk;
}

export function UploadZone({ onFilesChosen, onError, disabled, maxFiles, maxBytes }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragCount = useRef(0);

  const maxMb = Math.max(1, Math.round(maxBytes / (1024 * 1024)));

  function validateAndEmit(list: FileList | File[] | undefined | null) {
    if (!list) return;
    const picked = Array.from(list);
    if (picked.length === 0) return;
    const valid: File[] = [];
    for (const file of picked) {
      if (!isValidMov(file)) {
        onError(`"${file.name}" is not a MOV file. Only .mov videos are supported.`);
        continue;
      }
      if (file.size === 0) {
        onError(`"${file.name}" appears to be empty. Please choose a valid MOV file.`);
        continue;
      }
      if (file.size > maxBytes) {
        onError(`"${file.name}" is too large. Maximum allowed size is ${maxMb} MB per file.`);
        continue;
      }
      valid.push(file);
    }
    if (valid.length > maxFiles) {
      onError(`Too many files — only the first ${maxFiles} were kept (max ${maxFiles} per batch).`);
      onFilesChosen(valid.slice(0, maxFiles));
    } else if (valid.length > 0) {
      onFilesChosen(valid);
    }
  }

  function openPicker() {
    if (!disabled) inputRef.current?.click();
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Upload MOV files. Drag and drop files here, or press Enter to browse."
      aria-disabled={disabled}
      onClick={openPicker}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPicker();
        }
      }}
      onDragEnter={(e) => {
        if (disabled) return;
        e.preventDefault();
        dragCount.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (disabled) return;
        e.preventDefault();
        dragCount.current = Math.max(0, dragCount.current - 1);
        if (dragCount.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        dragCount.current = 0;
        setDragging(false);
        validateAndEmit(e.dataTransfer.files);
      }}
      className={`group rounded-2xl border-2 border-dashed p-8 text-center transition-all sm:p-10 ${
        dragging
          ? 'border-blue-500 bg-blue-50/70 shadow-[0_0_0_4px_rgba(59,130,246,0.12)]'
          : 'border-slate-300 bg-slate-50/60 hover:border-blue-400 hover:bg-blue-50/40'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      <div
        aria-hidden="true"
        className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm transition ${
          dragging ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 ring-1 ring-slate-200 group-hover:text-blue-700'
        }`}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2" />
          <path d="M12 12v9" />
          <path d="m8 16 4-4 4 4" />
        </svg>
      </div>
      <p className="mt-4 text-[17px] font-semibold tracking-tight">
        {dragging ? 'Drop your files to upload' : 'Drag & drop your MOV files here'}
      </p>
      <p className="mt-1 text-sm text-slate-500">or browse files from your device (up to {maxFiles} at once)</p>
      <span
        aria-hidden="true"
        className={`mt-5 inline-block rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition ${
          disabled ? 'bg-slate-300' : 'bg-blue-600 group-hover:bg-blue-700'
        }`}
      >
        Choose MOV Files
      </span>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11px] font-semibold">
        <span className="rounded-md bg-slate-900 px-2 py-1 text-white">.MOV ONLY</span>
        <span className="rounded-md bg-white px-2 py-1 text-slate-500 ring-1 ring-slate-200">Up to {maxMb} MB each</span>
        <span className="rounded-md bg-white px-2 py-1 text-slate-500 ring-1 ring-slate-200">Output: MP4 · H.264</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".mov,video/quicktime"
        multiple
        aria-label="Choose MOV files"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          validateAndEmit(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
