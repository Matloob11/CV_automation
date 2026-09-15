# Agent Notes for CV Auto

Read this file before making changes in this project.

## Product Purpose

CV Auto helps A7 Group Real Estate convert many uploaded CVs into structured HR
screening rows and a downloadable Excel file. The expected user is an office/HR
operator who wants to upload a folder and receive one row per candidate.

## Current Important Behavior

- The browser UI uses the incremental backend batch flow:
  `/api/batches`, `/api/batches/:jobId/files`,
  `/api/batches/:jobId/skip-file`, `/api/batches/:jobId/start`,
  `/api/jobs/:jobId`, and `/api/jobs/:jobId/download`.
- The UI does not currently use n8n for processing. n8n is only an optional
  bridge workflow in `n8n/`.
- Folder uploads must send one file per HTTP request. Do not reintroduce one huge
  multipart upload from the UI. Backend extraction is independently bounded by
  `PROCESSING_CONCURRENCY` and `MAX_IN_FLIGHT_MB`.
- Keep cache I/O and OpenAI extraction in separate bounded queues. Cache hits
  must not wait for an OpenAI worker; the AI queue must retain its memory budget.
- Duplicate files in the same batch are detected by content hash. Keep only the
  first copy and remove later copies from batch storage.
- Consecutive image pages may belong to one candidate. Extraction may complete
  out of order, but results must be flushed in filename/upload order before
  merging at most `MAX_IMAGE_PAGES_PER_CV` pages into one row.
- File progress and candidate rows are different counters: every page advances
  file progress, while merged pages must not create extra candidate/Excel rows.
- Files that OpenAI identifies as unrelated to a CV/resume must be marked
  `failed` and excluded from Excel.
- Filename-only or otherwise unusable candidate records must be marked `failed`.
  Keep failed rows available to the completion report, but out of the primary
  table, Candidate History, and Excel.
- `MAX_CV_FILE_SIZE_MB` is a per-file limit, not a total folder limit.
  Oversized CVs should be skipped individually while the rest continue.
- Excel export must include candidate details only. Do not include internal
  status/cache/error fields unless explicitly requested.
- Do not infer employment-sensitive personal data such as gender from a name,
  photo, honorific, pronoun, nationality, or cultural assumptions. Personal
  data must be explicit; supported professional derivations belong in
  `inferredFields`.
- Uploaded files, snapshots, Excel files, and extraction cache live under
  `storage/` and should be treated as runtime data.
- `/history.html` shows successful persisted and live candidate rows. Search is
  server-side and range numbers refer to the complete filtered result.
- Candidate downloads must stay inside the owning batch's `originals/` folder.
  One source downloads directly; merged pages and ranges stream as ZIP files.

## Files to Check First

- `docs/PROJECT_CONTEXT.md` for business and data requirements.
- `docs/ARCHITECTURE.md` for flow and storage.
- `docs/API.md` for endpoint contracts.
- `server.js` for HTTP composition and routes.
- `src/config.js` and `src/schema.js` for limits and data contracts.
- `src/queue/job-processor.js` and `src/queue/work-limiter.js` for concurrency.
- `src/agents/` for extraction, cache, grouping, storage, and Excel behavior.
- `src/agents/history-agent.js`, `src/agents/archive-agent.js`, and
  `public/history.js` for candidate history and downloads.
- `public/app.js` for UI upload/job flow.
- `public/styles.css` and `public/index.html` for UI structure.

## Coding Rules

- Keep changes scoped. This app is intentionally simple and does not have a
  frontend build step.
- Do not commit secrets. `.env` is local only; update `.env.example` for new env
  variables.
- Keep the A7 gold/white professional theme unless the user asks otherwise.
- When adding extraction fields, update all relevant places:
  `src/schema.js`, CV prompt/cleaning, grouping, Excel columns, UI table/cards,
  docs, and tests.
- Use one-based human progress language in the UI, but keep backend counters
  numeric and machine-friendly.
