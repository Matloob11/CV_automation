# API Reference

Base URL during local development:

```text
http://localhost:3000
```

## GET /api/health

Returns server status and limits.

Important fields:

- `ok`
- `mode`
- `n8nWebhookConfigured`
- `model`
- `maxFiles`
- `maxFileSizeMb`
- `processingConcurrency`
- `cacheConcurrency`
- `processingWindow`
- `maxInFlightMb`
- `activeWorkers`
- `queuedWorkers`
- `peakWorkers`
- `activeAiWorkers`, `queuedAiWorkers`, `peakAiWorkers`
- `activeCacheWorkers`, `queuedCacheWorkers`, `peakCacheWorkers`
- `candidateHistory`
- `storageDir`

## POST /api/batches

Creates an empty incremental upload job.

JSON body:

```json
{
  "appliedPost": "Sales Executive",
  "expectedTotal": 1000
}
```

Returns a public job object with `jobId`.

## POST /api/batches/:jobId/files

Uploads exactly one CV file to an existing job.

Multipart field:

```text
cv
```

The route uses the per-file size limit. If a single CV is too large, it returns
`413` and the frontend should call `/skip-file` for that file, then continue.

The route hashes each uploaded file. If its content already exists in the same
batch, the new copy is deleted, `duplicates` is incremented, and no second
candidate row is created.

## POST /api/batches/:jobId/skip-file

Records a skipped file without stopping the job.

JSON body:

```json
{
  "originalname": "folder/big-cv.pdf",
  "size": 157286400,
  "error": "File too large: 150 MB. Limit is 100 MB."
}
```

## POST /api/batches/:jobId/start

Marks upload complete. When all uploaded files are processed, the backend
generates Excel and marks the job as `completed`.

## GET /api/jobs/:jobId

Returns live job status from memory, or persisted `results.json` if the job is no
longer in memory.

Common fields:

- `status`: `uploading`, `queued`, `processing`, `completed`, or `failed`
- `total`
- `processed`: files/pages handled
- `processedFiles`: explicit alias for file/page progress
- `succeeded`: successful candidate rows
- `failed`
- `uploaded`
- `skipped`
- `duplicates`
- `groupedPages`: extra image pages merged into candidate rows
- `rowsVersion`: increments even when a page merges without adding a row
- `activeWorkers`: workers currently active for this job
- `peakWorkers`: highest simultaneous workers observed for this job
- `rows`
- `downloadUrl`
- `storageFolder`

`rows` contains internal failed rows for the completion report. The primary UI,
Candidate History, and Excel export show only successful rows that pass the
minimum candidate-detail policy.

## GET /api/jobs/:jobId/download

Downloads the generated Excel file. Returns `409` if the file is not ready yet.

## GET /api/candidates

Returns successful candidate history from persisted snapshots plus current live
jobs.

Query parameters:

```text
search    optional multi-field search text
page      one-based page number
pageSize  10 to 100 rows
```

The response includes `items`, `total`, `totalAll`, `batchCount`, `page`,
`pageSize`, `totalPages`, and `maxDownloadCandidates`. Each item has a stable
`id`, one-based `position`, candidate details, source-file metadata,
`hasDownload`, and `downloadUrl`.

## GET /api/candidates/:candidateId/download

Downloads the candidate's original stored CV. A single source keeps its original
format. A merged image CV with multiple source pages returns a ZIP.

## GET /api/candidates/download-range

Streams a ZIP for an inclusive one-based range of the current filtered history.

Query parameters:

```text
search  optional; must match the active history search
from    first one-based result position
to      last one-based result position
```

Invalid ranges return `400`; configured candidate-count or archive-size limits
return `413`.

## Legacy: POST /api/extract

Bulk upload endpoint. It accepts `cvs` as multipart files and can return sync or
async results. The current UI should not use this for folder uploads because the
incremental batch flow is safer for large folders.

## n8n: POST /api/process-cvs

Used by the optional n8n bridge. Requires header:

```text
x-workflow-secret: <CV_WORKFLOW_SECRET>
```

This endpoint still uses multipart field `cvs`.
