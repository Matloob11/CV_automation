# Architecture

## High-Level Shape

```text
Browser
  public/index.html
  public/styles.css
  public/app.js
        |
        v
Express server
  server.js
        |
        +-- src/queue: separate cache/AI lanes and ordered commits
        +-- src/agents: file routing, OpenAI, cache, grouping, Excel, storage
        +-- storage/cv-batches for uploads, snapshots, Excel
        +-- storage/cache/cv-extractions for repeated CV cache
        +-- optional n8n bridge endpoint
```

There is no frontend build system. The Express server serves `public/` directly.

## Backend Responsibilities

`server.js` composes dependencies and handles routes. Implementation is divided
into these modules:

```text
src/
  config.js                       environment and runtime limits
  schema.js                       extraction and Excel contracts
  agents/
    image-agent.js                image input preparation
    pdf-agent.js                  PDF text/vision preparation
    document-agent.js             DOCX/TXT/MD/RTF text preparation
    input-router.js               per-type dispatch
    openai-agent.js               strict output and retry/backoff
    cv-agent.js                   classification, prompt, cache orchestration
    candidate-policy.js           minimum usable-detail validation
    cache-agent.js                versioned extraction cache
    history-agent.js              persisted/live search and file resolution
    archive-agent.js              streamed single/range CV downloads
    grouping-agent.js             ordered image-page merge
    excel-agent.js                candidate-only workbook generation
    storage-agent.js              hashing, batches, atomic snapshots
  queue/
    work-limiter.js               reusable concurrency and weight budget
    job-processor.js              incremental scheduling and ordered flush
  http/
    upload-middleware.js          multer disk upload handling
```

## Primary Incremental Batch Flow

```text
POST /api/batches
  creates empty job and storage folder

POST /api/batches/:jobId/files
  uploads one CV, discards duplicate content, and starts/continues processing

POST /api/batches/:jobId/skip-file
  records one skipped file, usually because it is over the per-file limit

POST /api/batches/:jobId/start
  marks upload complete, allowing final Excel creation

GET /api/jobs/:jobId
  returns live or persisted progress

GET /api/jobs/:jobId/download
  downloads generated Excel
```

Processing begins while uploads are still arriving. The browser still uploads
one file per request. Cache reads use a 20-worker lightweight lane, while cache
misses use up to 10 OpenAI workers.

Folder files are sorted by relative filename in the browser. Each extraction is
independent and may finish out of order. `job-processor.js` buffers completed
results and commits them in original order. `grouping-agent.js` then uses
identity, filename, and `isContinuationPage` evidence to merge pages. The group
is capped by `MAX_IMAGE_PAGES_PER_CV` (default `3`).

File progress advances when each cache/AI task finishes, even if its row is
briefly waiting in the ordered commit buffer. This keeps progress responsive
without weakening deterministic image-page grouping.

Both limiters are global, so several jobs cannot each multiply the configured
limits. Cache hits never wait for an OpenAI worker. The AI lane estimates
in-flight bytes; large files consume more of `MAX_IN_FLIGHT_MB` and
automatically lower actual AI concurrency.
Progress snapshots are coalesced by file activity/time instead of rewriting the
entire growing `results.json` after every event. Upload completion, job
completion, and job failure always force a final snapshot.

## Candidate History Flow

```text
public/history.html + history.js
        |
        +-- GET /api/candidates (search + pagination)
        +-- GET /api/candidates/:id/download
        +-- GET /api/candidates/download-range
                  |
                  +-- history-agent reads cached snapshots
                  +-- live jobs overlay persisted rows by deterministic ID
                  +-- archive-agent streams ZIP entries with archiver
```

The history cache avoids rescanning every batch on each request. Live jobs are
merged on every request, so completed rows from the current process appear
immediately even while the persisted scan cache is warm. Candidate IDs encode a
validated batch ID and row index; stored filenames are reduced to basenames
before resolving under `storage/cv-batches/<batch-id>/originals`.

## Storage Layout

```text
storage/
  cv-batches/
    <batch-id>/
      originals/
        00001-candidate.pdf
      results.json
      cv-extraction-<timestamp>.xlsx
  cache/
    cv-extractions/
      <sha256>.json
```

Cache keys include schema version, model, file hash, and default applied post.
They do not depend on a previous image page, which allows independent parallel
extraction. Changing `schemaVersion` in `src/config.js` invalidates old cache
entries.

## OpenAI Extraction

OpenAI is called through `openai-agent.js`. PDF and document agents first attempt
local text extraction. If enough PDF text is found, only text is sent. Otherwise
the PDF or image is sent as visual/file input.

The schema is strict. If fields change, update every downstream consumer.
It includes internal `isResume`, `rejectionReason`, `inferredFields`, and
continuation fields. These affect validation/grouping/provenance only and are not
Excel columns. Temporary 408/409/429, connection, timeout, and 5xx failures use
bounded exponential backoff with jitter.

`processed` counts handled files/pages so progress reaches the upload total.
`succeeded` counts successful candidate rows, and `groupedPages` counts extra
image pages merged into those candidates.

`candidate-policy.js` rejects filename placeholders and rows without enough
candidate evidence. The CV agent marks new unusable extractions failed, while
Excel and Candidate History apply the same policy as defense in depth.

## UI Responsibilities

`public/app.js` handles:

- Health check.
- File/folder selection.
- Supported extension filtering.
- Per-file size pre-check.
- Sequential upload.
- Skipped file reporting.
- Job polling.
- Desktop table rendering.
- Mobile card rendering.
- Successful/failed result separation and the completion-time failed-file
  dialog.
- Excel download.

`public/styles.css` owns the A7 gold/white visual theme.

## Optional n8n Bridge

The n8n workflow is a pass-through bridge. It does not perform OpenAI parsing.
The backend remains the source of truth for parsing, cache, storage, and Excel.
