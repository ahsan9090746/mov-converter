# MOV to MP4 Converter (V1)

Production-structured online **MOV → MP4** converter. Next.js frontend + Express + FFmpeg backend, deployable to Render as two separate services.

Browser → Next.js → Express REST API → secure upload → temp storage → FFmpeg (H.264 + AAC) → MP4 download → automatic cleanup.

## Features

- Drag & drop + keyboard-accessible `.mov` upload with validation
- File name / size / type preview, remove option
- Real upload progress (XHR bytes) + real FFmpeg progress (stderr `time=` vs `Duration:`)
- Statuses: `queued / uploading / processing / completed / failed / expired`
- UUID job IDs, `POST /api/convert`, `GET /api/status/:jobId`, `GET /api/download/:jobId`, `GET /api/health`
- Secure upload: 500 MB default (env-configurable), extension + MIME check, UUID filenames, path-traversal guards, non-public storage
- Auto cleanup after download + periodic stale-job sweeper (`CLEANUP_AFTER_MINUTES`)
- Helmet, configurable CORS (never `*` in prod), rate limiting, centralized JSON errors (no stack traces)
- SEO metadata, responsive + accessible UI

## Architecture

```
/frontend  Next.js 14 + TS + Tailwind (app/, components/, lib/api.ts)
/backend   Express + TS (config/controllers/routes/services/middleware/jobs/utils/types)
render.yaml  Render blueprint (api + frontend web services)
```

In-memory `jobStore` is intentional for single-instance V1. For multi-instance/autoscaled deployments, replace with Redis or a DB-backed job table (see § Future improvements).

Render uses an **ephemeral filesystem**: uploads/conversions are temporary by design. For a scalable version use object storage (S3 / Cloudflare R2).

## Requirements

- Node.js 18+
- FFmpeg: the backend bundles `ffmpeg-static` (works on Render/Linux with zero setup). Optionally set `FFMPEG_PATH` to a system binary.
  - Windows (local dev): `winget install Gyan.FFmpeg` or `choco install ffmpeg`, or rely on `ffmpeg-static` fallback
  - Linux: `sudo apt install ffmpeg` or rely on bundled binary
  - Render: no action needed (bundled binary)

## Local development

```bash
# backend
cd backend
cp .env.example .env   # Windows: copy .env.example .env
npm install
npm run dev            # http://localhost:8000

# frontend (second terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev            # http://localhost:4000
```

Verify: `GET http://localhost:8000/api/health` → `{"success":true,"status":"healthy"}`.

## Environment variables

Backend (`backend/.env.example`, never commit real `.env`):

| Key | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `production` on Render |
| `PORT` | `8000` | Render injects its own; code uses `process.env.PORT` with fallback |
| `FRONTEND_URL` | `http://localhost:4000,http://127.0.0.1:4000` | Allowed CORS origin(s), comma-separated |
| `MAX_FILE_SIZE_MB` | `500` | Upload cap |
| `CLEANUP_AFTER_MINUTES` | `30` | Stale-job deletion window |
| `FFMPEG_PATH` | _(unset)_ | Optional system binary override |
| `MAX_CONCURRENT_CONVERSIONS` | `2` | CPU guard |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `900000` / `100` | API rate limits |

Frontend (`frontend/.env.example`):

| Key | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend base URL, consumed only via `lib/api.ts` |

## Production build

```bash
cd backend && npm install && npm run build && npm start
cd frontend && npm install && npm run build && npm start
```

## Render deployment

Option A — Blueprint (`render.yaml` at repo root):

1. Push repo to GitHub.
2. Render Dashboard → New → Blueprint → select repo. Render creates `mov-converter-api` + `mov-converter-frontend`.
3. Confirm env vars (Render → service → Environment):
   - API: `NODE_ENV=production`, `FRONTEND_URL=https://mov-converter-frontend.onrender.com`, `MAX_FILE_SIZE_MB=500`, `CLEANUP_AFTER_MINUTES=30`
   - Frontend: `NEXT_PUBLIC_API_URL=https://mov-converter-api.onrender.com`
4. Health check: API service uses `/api/health` (already in `render.yaml`).

Option B — manual (two Web Services):

- **API**: Root Directory `backend`, Build `npm install && npm run build`, Start `npm start`, Health Check `/api/health`, add backend env vars above.
- **Frontend**: Root Directory `frontend`, Build `npm install && npm run build`, Start `npm start`, add `NEXT_PUBLIC_API_URL` pointing at the live API URL. Rebuild frontend after changing it (it's baked at build time).

CORS: backend allows only `FRONTEND_URL`; update it to the real frontend URL in production.

## API reference

- `GET /api/health` → `{ success, status: 'healthy' }`
- `POST /api/convert` (multipart `file`) → `202 { success, jobId, status: 'processing' }`
- `GET /api/status/:jobId` → processing `{ success, status:'processing', progress }`, completed `{ success, status:'completed', progress:100, downloadUrl }`, failed → `422 { success:false, status:'failed', message }`
- `GET /api/download/:jobId` → `video/mp4` attachment, deleted ~5 s after delivery

## Security

Helmet, CORS allowlist, rate limits, 1 MB JSON cap, Multer size/file-count caps, `.mov` + MIME validation, memory upload → UUID job dir under `storage/jobs/` (never public), `Content-Disposition` with sanitized name, `spawn` arg array (no shell), no stack traces/paths in responses, structured `[UPLOAD]/[CONVERSION_*]/[CLEANUP]` logs without secrets.

## Limitations (Render V1)

- Ephemeral disk: files vanish on restart/redeploy — by design, always auto-deleted.
- In-memory jobs: single instance only; restarts lose job state (orphan dirs swept by mtime).
- CPU-bound conversions: `MAX_CONCURRENT_CONVERSIONS=2` default; large 4K files may be slow on Starter.
- No auth / DB / queue / multi-format (intentionally out of scope for V1).

## Future improvements

Redis/BullMQ or DB-backed jobs, S3/R2 object storage + presigned URLs, progress via SSE/WebSocket, more formats, auth/quotas, ClamAV scan, Prometheus metrics.

## Testing performed

- `npm run typecheck` + `npm run build` in both workspaces (Next 14.2.35, multer 2.x, uuid latest)
- `GET /api/health` returns healthy; production `next start` serves the landing page with correct SEO title
- Full E2E with real FFmpeg (bundled `ffmpeg-static` 6.1.1): generated a 2 s test-pattern `.mov` → `POST /api/convert` → 202 → polled to `completed` → downloaded valid MP4 (`ftypisom`, `video/mp4`, sanitized `Content-Disposition`) → job auto-deleted (~5 s after download, status 404)
- Failure path: corrupt `.mov` → `422 { status:'failed', message }`, surfaced in UI with retry (no infinite polling; polling also aborts after 10 consecutive network errors)
- Invalid extension/MIME rejected (`Only MOV files are supported.`), oversize → 413, unknown job → 404, disallowed CORS origin → 403 JSON
- Source scanned for hardcoded `localhost` URLs (only dev-fallback default in `backend/src/config/env.ts`, overridden by env) and secrets: clean
