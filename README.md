# CV Auto

CV Auto is an internal HR screening desk for **A7 Group Real Estate**. Staff upload one CV, many CVs, or a full folder. The backend extracts structured candidate fields with OpenAI, shows one row per person, and produces a clean Excel workbook for review.

It is not a job board, ATS, or applicant database. The product is a batch extraction desk: upload, extract, review, download.

---

## What operators get

- Upload individual CVs or a whole folder, one file per HTTP request
- Process large folders while cache checks and OpenAI extraction run in separate bounded queues
- Skip only the CV that exceeds the per-file size limit; the rest of the batch continues
- Detect duplicate files in the same batch by content hash and keep the first copy
- Merge up to three consecutive image pages into one candidate when they belong to the same person
- Reject non-CV files and unusable filename-only records from the main table, Candidate History, and Excel
- Show a Failed Files report after completion with source filenames and concise reasons
- Search successful candidates on `/history.html` and download originals or range ZIPs
- Push successful rows to Bitrix24 when a webhook is configured locally
- Keep the A7 gold/white professional theme without a frontend build step

---

## How processing works

```text
Browser UI
  public/index.html  +  public/app.js
        |
        v
Express backend  (server.js)
        |
        +-- cache lane: up to CACHE_CONCURRENCY lightweight reads
        +-- AI lane: up to PROCESSING_CONCURRENCY OpenAI workers
        +-- ordered flush: results commit in upload/filename order
        +-- grouping: consecutive image pages may become one row
        |
        v
storage/  ->  Excel download  ->  optional Bitrix24 sync
```

The browser UI talks to the incremental batch API:

1. `POST /api/batches` creates an empty job
2. `POST /api/batches/:jobId/files` uploads one CV and starts or continues processing
3. Oversized files are recorded with `POST /api/batches/:jobId/skip-file`
4. `POST /api/batches/:jobId/start` marks the upload complete
5. `GET /api/jobs/:jobId` returns live progress
6. `GET /api/jobs/:jobId/download` returns the generated Excel file

n8n is optional. The current UI does not send CVs through n8n.

---

## Requirements

- Node.js 20 or later
- npm
- An OpenAI API key with access to a vision-capable model such as `gpt-4o-mini`
- Optional: a Bitrix24 incoming webhook for CRM sync

---

## Quick start

```bash
git clone https://github.com/Matloob11/CV_automation.git
cd CV_automation
npm install
copy .env.example .env
```

On macOS or Linux use `cp .env.example .env` instead of `copy`.

Edit `.env` and set at least:

```env
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4o-mini
```

Start the server:

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000). Candidate History is at [http://localhost:3000/history.html](http://localhost:3000/history.html).

For local reload during development:

```bash
npm run dev
```

---

## Daily operator workflow

1. Open the browser UI.
2. Optionally enter a default applied post, for example `Sales Executive`.
3. Choose individual CV files or a folder of CVs.
4. The UI creates a backend batch and uploads files one by one.
5. Cache hits return immediately. Cache misses go to OpenAI within the memory budget.
6. Image pages are extracted independently, restored to filename order, then merged when they belong to one person.
7. Review successful rows in the table or mobile cards.
8. Download Excel when the job completes.
9. Use Candidate History later to search and download stored originals.

Supported inputs include PDF, DOCX, DOC, TXT, MD, RTF, PNG, JPG, JPEG, and WEBP.

---

## Extracted fields

Successful Excel rows include candidate details only. Internal status, cache, and error fields are not exported.

| Excel column | Source field |
| --- | --- |
| Full Name | `name` |
| Mobile 1 | `phoneNumber` |
| Mobile 2 | `secondaryPhone` |
| Email Address | `email` |
| Gender | `gender` |
| Date of Birth | `dateOfBirth` |
| Age | `age` |
| Nationality | `nationality` |
| Address | `address` |
| City | `city` |
| Country | `country` |
| Current Position | `designation` |
| Job Listing / Applied Post | `appliedPost` |
| Field of Experience | `fieldOfExperience` |
| Field of Study / Specialisation | `fieldOfStudy` |
| Total Years Experience | `totalExperienceYears` |
| Dubai Experience (Yrs) | `dubaiExperienceYears` |
| Previous Employers | `previousEmployers` |
| Highest Education | `education` |
| Summary | `summary` |
| Skills | `skills` |
| LinkedIn | `linkedin` |
| Instagram | `instagram` |
| Facebook | `facebook` |
| Other Social / Link | `otherSocialLink` |
| Visa Status | `visaStatus` |
| Visa Expiry Date | `visaExpiryDate` |
| Spouse Visa (Y/N) | `spouseVisa` |
| Visa Sponsor Name | `visaSponsorName` |
| Notice Period / Availability | `noticePeriod` |
| Salary Expectations | `salaryExpectations` |

### Evidence rules

- Name, phone, email, date of birth, and address must appear in the CV.
- Gender must be explicitly labeled or self-identified. It is never inferred from a name, photo, honorific, pronoun, nationality, or cultural assumption.
- Professional fields such as designation, experience, skills, and education may be derived from CV evidence.
- Filename-only or otherwise unusable records are marked failed and stay out of Excel and Candidate History.

---

## Environment variables

Copy `.env.example` to `.env`. Never commit `.env`.

| Variable | Purpose | Default |
| --- | --- | --- |
| `OPENAI_API_KEY` | Required OpenAI key | — |
| `OPENAI_MODEL` | Extraction model | `gpt-4o-mini` |
| `BITRIX24_WEBHOOK_URL` | Optional incoming webhook. Leave empty if unused | empty |
| `BITRIX24_ENTITY_TYPE_ID` | Bitrix24 smart-process type | `1156` |
| `N8N_WEBHOOK_URL` | Optional n8n bridge | empty |
| `CV_WORKFLOW_SECRET` | Shared secret for `/api/process-cvs` | `change-this-secret` |
| `MAX_CV_FILES` | Max files per batch | `2000` |
| `MAX_CV_FILE_SIZE_MB` | Per-file size limit, not a folder limit | `100` |
| `MAX_IMAGE_PAGES_PER_CV` | Max adjacent images merged into one row | `3` |
| `PROCESSING_CONCURRENCY` | OpenAI workers | `10` |
| `CACHE_CONCURRENCY` | Cache I/O workers | `20` |
| `MAX_IN_FLIGHT_MB` | Global estimated memory budget for AI work | `220` |
| `PORT` | HTTP port | `3000` |

`MAX_CV_FILE_SIZE_MB` applies to each file. A folder of hundreds or thousands of CVs is valid as long as each file is within the limit.

---

## Project structure

```text
server.js                 HTTP composition and routes
src/config.js             Environment and runtime limits
src/schema.js             Extraction and Excel contracts
src/agents/               Input routing, OpenAI, cache, grouping, Excel, history
src/queue/                Separate cache/AI lanes and ordered job commits
src/http/                 Multipart upload middleware
public/                   Browser UI, no build step
scripts/                  Optional Bitrix24 and Excel maintenance utilities
n8n/                      Optional upload-bridge workflow
test/                     Node test runner coverage
docs/                     Product, architecture, and API notes
storage/                  Runtime data only; not source code
```

Important implementation files:

- `src/queue/job-processor.js` and `src/queue/work-limiter.js` own concurrency
- `src/agents/cv-agent.js` owns classification, prompt, and cache orchestration
- `src/agents/grouping-agent.js` owns consecutive image-page merge
- `src/agents/candidate-policy.js` owns the usable-candidate rule
- `public/app.js` owns the incremental upload and polling UI

---

## Storage and privacy

Runtime data lives under `storage/` and must stay local:

```text
storage/cv-batches/<batch-id>/originals/
storage/cv-batches/<batch-id>/results.json
storage/cv-batches/<batch-id>/cv-extraction-<timestamp>.xlsx
storage/cache/cv-extractions/<sha256>.json
```

This repository is source code only. The following are excluded from Git:

- `.env` and any real API keys or webhook tokens
- Uploaded CVs and generated Excel files
- Extraction cache and job snapshots
- Local workbooks such as application exports
- The `Hired Emplyee` folder and other raw candidate files

If you clone this project, create your own `.env` from `.env.example`. Do not paste production secrets into source files or commit messages.

---

## Tests

```bash
npm test
```

The suite covers candidate policy, image grouping, concurrency lanes, OpenAI retries, history/archive behavior, and Excel output.

---

## API summary

Full contracts are in [docs/API.md](docs/API.md).

| Method | Path | Role |
| --- | --- | --- |
| `GET` | `/api/health` | Server status and current limits |
| `POST` | `/api/batches` | Create an incremental job |
| `POST` | `/api/batches/:jobId/files` | Upload one CV |
| `POST` | `/api/batches/:jobId/skip-file` | Record one oversized or skipped file |
| `POST` | `/api/batches/:jobId/start` | Mark upload complete |
| `GET` | `/api/jobs/:jobId` | Live or persisted job status |
| `GET` | `/api/jobs/:jobId/download` | Download Excel |
| `GET` | `/api/candidates` | Search successful history |
| `GET` | `/api/candidates/:id/download` | Download one stored CV or page ZIP |
| `GET` | `/api/candidates/download-range` | Stream a filtered range ZIP |
| `POST` | `/api/process-cvs` | Optional n8n bridge; requires `x-workflow-secret` |

Folder uploads must stay one file per request. Do not send one huge multipart folder upload from the UI.

---

## Optional Bitrix24 sync

The UI can send a successful candidate to Bitrix24 when `BITRIX24_WEBHOOK_URL` is set in the local `.env`. Utility scripts under `scripts/` also read that variable and exit if it is missing.

Never put a real webhook token in `.env.example`, source defaults, or documentation.

---

## Documentation

- [Project context](docs/PROJECT_CONTEXT.md) — business rules and extraction policy
- [Architecture](docs/ARCHITECTURE.md) — queues, storage, and processing flow
- [API reference](docs/API.md) — endpoint contracts
- [n8n notes](docs/N8N.md) — optional bridge workflow
- [Storage notes](storage/README.md) — runtime data layout
- [Agent notes](AGENTS.md) — rules for future code changes

---

## License

Private repository for A7 Group Real Estate internal use.
