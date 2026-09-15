import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDir, '..');

function numberFromEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = true } = {}) {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  const bounded = Math.min(max, Math.max(min, value));
  return integer ? Math.trunc(bounded) : bounded;
}

const maxFileSizeMb = numberFromEnv('MAX_CV_FILE_SIZE_MB', 100, { min: 1, max: 1024 });
const maxInFlightMb = numberFromEnv('MAX_IN_FLIGHT_MB', 220, { min: maxFileSizeMb, max: 4096 });
const processingConcurrency = numberFromEnv('PROCESSING_CONCURRENCY', 10, { min: 1, max: 50 });
const cacheConcurrency = numberFromEnv('CACHE_CONCURRENCY', 20, { min: 1, max: 200 });
const storageRoot = path.resolve(projectRoot, process.env.CV_STORAGE_DIR || 'storage');

export const config = Object.freeze({
  projectRoot,
  port: numberFromEnv('PORT', 3000, { min: 1, max: 65535 }),
  maxFiles: numberFromEnv('MAX_CV_FILES', 2000, { min: 1, max: 10000 }),
  maxFileSizeMb,
  maxFileSizeBytes: maxFileSizeMb * 1024 * 1024,
  processingConcurrency,
  cacheConcurrency,
  processingWindow: processingConcurrency + cacheConcurrency,
  maxInFlightMb,
  maxInFlightBytes: maxInFlightMb * 1024 * 1024,
  maxImagePagesPerCandidate: numberFromEnv('MAX_IMAGE_PAGES_PER_CV', 3, { min: 1, max: 20 }),
  openAiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  openAiTimeoutMs: numberFromEnv('OPENAI_TIMEOUT_MS', 180000, { min: 10000, max: 600000 }),
  openAiMaxRetries: numberFromEnv('OPENAI_MAX_RETRIES', 4, { min: 0, max: 10 }),
  openAiRetryBaseMs: numberFromEnv('OPENAI_RETRY_BASE_MS', 1000, { min: 100, max: 30000 }),
  openAiRetryMaxMs: numberFromEnv('OPENAI_RETRY_MAX_MS', 20000, { min: 1000, max: 120000 }),
  snapshotEveryFiles: numberFromEnv('SNAPSHOT_EVERY_FILES', 5, { min: 1, max: 100 }),
  snapshotIntervalMs: numberFromEnv('SNAPSHOT_INTERVAL_MS', 1000, { min: 100, max: 30000 }),
  historyCacheMs: numberFromEnv('HISTORY_CACHE_MS', 30000, { min: 1000, max: 300000 }),
  historyDefaultPageSize: numberFromEnv('HISTORY_PAGE_SIZE', 50, { min: 10, max: 100 }),
  historyMaxPageSize: 100,
  maxHistoryDownloadCandidates: numberFromEnv('MAX_HISTORY_DOWNLOAD_CANDIDATES', 500, {
    min: 1,
    max: 5000
  }),
  maxHistoryArchiveMb: numberFromEnv('MAX_HISTORY_ARCHIVE_MB', 5000, { min: 100, max: 102400 }),
  localTextThreshold: numberFromEnv('LOCAL_TEXT_THRESHOLD', 80, { min: 20, max: 1000 }),
  maxPromptTextChars: numberFromEnv('MAX_PROMPT_TEXT_CHARS', 50000, { min: 5000, max: 200000 }),
  workflowSecret: process.env.CV_WORKFLOW_SECRET || 'cv-auto-local-secret',
  bitrixWebhookUrl: process.env.BITRIX24_WEBHOOK_URL || '',
  bitrixEntityTypeId: numberFromEnv('BITRIX24_ENTITY_TYPE_ID', 1156, { min: 1, max: 10000 }),
  schemaVersion: 'cv-schema-v6',
  storageRoot,
  batchesRoot: path.join(storageRoot, 'cv-batches'),
  cacheRoot: path.join(storageRoot, 'cache', 'cv-extractions')
});
