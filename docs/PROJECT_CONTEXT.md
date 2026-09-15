# Project Context

## What This Project Does

CV Auto extracts structured candidate data from uploaded CVs/resumes. It is made
for A7 Group Real Estate so staff can upload many CVs and download an Excel file
where each row is one person.

The tool is not a job board, ATS, or applicant database. It is a batch extraction
desk: upload, extract, review, download.

## User Workflow

1. User opens the browser UI.
2. User optionally enters a default applied post, such as `Sales Executive`.
3. User uploads individual CV files or a full folder.
4. The UI creates a backend batch.
5. Files are uploaded one by one.
6. Files over the per-file size limit are skipped individually.
7. Duplicate content in the same batch is kept once; later copies are deleted.
8. Backend starts processing as files arrive. Cache checks use up to
   `CACHE_CONCURRENCY` workers; cache misses use up to
   `PROCESSING_CONCURRENCY` OpenAI workers within a global memory budget.
9. Each image page is extracted independently. Completed pages are restored to
   filename/upload order, then up to three matching consecutive pages are
   merged into one person.
10. Unrelated documents and files without usable candidate details are marked
    failed instead of becoming candidate rows.
11. UI polls file progress and shows one extracted row per candidate.
12. User downloads Excel when the job completes.
13. Successful rows remain available on Candidate History for search and
    original-CV downloads.
14. After completion, failed source filenames and concise reasons are available
    from the `Failed Files` dialog.
15. The current job ID is retained in the page URL/browser storage so a refresh
    can restore completed results and the failed-file report.

## Extracted Candidate Fields

The canonical candidate fields are:

- `name`
- `phoneNumber`
- `email`
- `gender`
- `dateOfBirth`
- `address`
- `designation`
- `appliedPost`
- `city`
- `summary`
- `skills`
- `totalExperienceYears`
- `education`

The backend also uses internal fields such as `status`, `error`, `cacheHit`,
`missingFields`, `inferredFields`, `confidence`, `isResume`, `rejectionReason`,
`isContinuationPage`, `continuationConfidence`, `pageNumber`, `pageCount`,
`sourceFiles`, and `storedFiles`. These are useful for grouping/UI/debugging but
should not appear in the downloaded Excel unless the user explicitly asks.

## Extraction and Inference Rules

- Personal data is evidence-only. Name, phone, email, date of birth, and address
  must be visible in the CV.
- Gender must be explicitly labeled or self-identified. It must not be guessed
  from a name, photo, title, pronoun, nationality, or cultural assumption.
- Professional fields such as designation, applied post, summary, total
  experience, skills, and education may be derived from CV evidence.
- A generated summary, default applied post, or copied source filename does not
  make a candidate row usable. A readable identity/contact plus supporting
  candidate detail is required. Evidence-rich continuation image pages remain
  eligible for page grouping.
- Every derived/calculated/default-filled key is listed in `inferredFields` for
  provenance, but that internal list is not exported to Excel.

## Excel Rules

Excel contains successful, usable candidate rows only. Non-CV, unclear,
filename-only, failed, and skipped rows are filtered out. Duplicate copies do
not create an extra UI or Excel row.

Current Excel headers:

```text
Name
Phone Number
Email
Gender
Date of Birth
Address
Designation
Applied Post
City
Summary
Skills
Total Experience
Education
```

## Candidate History Rules

- `/history.html` lists successful candidate rows from persisted and current
  jobs. Failed, skipped, and non-CV rows are not listed.
- Search covers name, phone, email, designation, applied post, city, address,
  education, skills, experience, source filename, and batch ID.
- Results are newest-batch-first and use one-based positions. Range downloads
  apply to the complete current search result, not only the visible page.
- A candidate with one stored source downloads in its original format.
- A merged multi-page image candidate downloads all pages in one ZIP.
- Range ZIPs are streamed and group files by candidate; they are not buffered
  fully in server memory.
- `MAX_HISTORY_DOWNLOAD_CANDIDATES` and `MAX_HISTORY_ARCHIVE_MB` bound one range
  download.

## Upload Limits

- `MAX_CV_FILES` is the max file count per batch.
- `MAX_CV_FILE_SIZE_MB` is a per-CV file size limit.
- The total folder size is not the limit.
- A folder may contain hundreds or thousands of CVs. The app should keep
  uploading and processing them one by one.
- Duplicate detection uses file-content hashes, so renamed copies are still
  treated as duplicates within the same batch.
- Image CV pages are processed in relative filename order. Pages for one person
  should be adjacent; explicit names such as `Ali-page-1.jpg` and
  `Ali-page-2.jpg` improve grouping reliability.
- `MAX_IMAGE_PAGES_PER_CV` limits how many adjacent image files can merge into
  one candidate row. The default is `3`.
- `CACHE_CONCURRENCY` controls lightweight cache reads/writes. The default is
  `20`.
- `PROCESSING_CONCURRENCY` controls simultaneous OpenAI extraction workers. The
  default is `10`.
- `MAX_IN_FLIGHT_MB` is a global estimated memory budget. Large PDFs/images can
  lower real AI concurrency below ten so the process remains stable.

## Multi-Page Image Rules

- PDFs remain one input document and do not use image-page grouping.
- Only consecutive PNG/JPG/JPEG/WEBP files can merge.
- Matching phone, email, candidate name, explicit filename page suffix, and the
  independent OpenAI continuation-page decision are used as grouping evidence.
- A conflicting candidate identity starts a new row even if the files are
  adjacent.
- Every image advances file progress, but merged pages increment
  `groupedPages` and do not create another UI or Excel row.
- A failed, skipped, unrelated, or non-image file ends the current image group.

## Current n8n Status

n8n is not in the primary UI processing path. The UI talks directly to the
Express backend. The n8n workflow in `n8n/cv-auto-upload-bridge.workflow.json`
is an optional bridge that can forward uploads to `/api/process-cvs`.

If a future feature should use n8n from the UI, update `public/app.js`,
`docs/N8N.md`, and the workflow JSON together.

## Feature Change Checklist

When adding a new extracted field:

1. Add it to `candidateFields` and `resumeSchema` in `src/schema.js`.
2. Add it to the `required` list in the schema.
3. Add prompt and cleaning guidance in `src/agents/cv-agent.js` and
   `src/schema.js`.
4. Add merge behavior in `src/agents/grouping-agent.js` when image pages should
   combine the field.
5. Add it to `excelColumns` if it should export.
6. Add it to `public/index.html` table header.
7. Add it to `public/app.js` desktop row and mobile card rendering.
8. Update these docs.

When changing upload behavior:

1. Preserve one-by-one browser upload; do not create one huge multipart folder
   request.
2. Preserve individual oversized-file skip behavior.
3. Verify the UI still uses `/api/batches` incremental endpoints.
4. Verify Excel still excludes failed/skipped rows.
5. Preserve bounded global concurrency and ordered result flushing.

When changing candidate history:

1. Keep candidate IDs tied to batch ID and actual row index.
2. Resolve stored files with basenames under that batch's `originals/` folder.
3. Keep failed/internal rows out of history.
4. Preserve filtered one-based range semantics and streamed ZIP output.
5. Verify both `/history.html` desktop table and mobile cards.
