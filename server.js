import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';

import { config } from './src/config.js';
import { resumeSchema } from './src/schema.js';
import { isMainModule, safeString } from './src/lib/utils.js';
import { createBitrixAgent } from './src/agents/bitrix-agent.js';
import { createCacheAgent } from './src/agents/cache-agent.js';
import { createArchiveAgent } from './src/agents/archive-agent.js';
import { createCvAgent } from './src/agents/cv-agent.js';
import { createDocumentAgent } from './src/agents/document-agent.js';
import { createExcelAgent } from './src/agents/excel-agent.js';
import { createGroupingAgent } from './src/agents/grouping-agent.js';
import { createHistoryAgent } from './src/agents/history-agent.js';
import { createImageAgent } from './src/agents/image-agent.js';
import { createInputRouter } from './src/agents/input-router.js';
import { createOpenAiAgent } from './src/agents/openai-agent.js';
import { createPdfAgent } from './src/agents/pdf-agent.js';
import { createStorageAgent } from './src/agents/storage-agent.js';
import { createUploadMiddleware } from './src/http/upload-middleware.js';
import { createJobProcessor } from './src/queue/job-processor.js';
import { WorkLimiter } from './src/queue/work-limiter.js';

const currentFile = fileURLToPath(import.meta.url);
const app = express();
const storageAgent = createStorageAgent(config);
const cacheAgent = createCacheAgent(config);
const bitrixAgent = createBitrixAgent({ config });
const imageAgent = createImageAgent();
const pdfAgent = createPdfAgent(config);
const documentAgent = createDocumentAgent();
const inputRouter = createInputRouter({ imageAgent, pdfAgent, documentAgent });
const openAiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'missing-openai-api-key',
  maxRetries: 0,
  timeout: config.openAiTimeoutMs
});
const openAiAgent = createOpenAiAgent({ client: openAiClient, config, schema: resumeSchema });
const groupingAgent = createGroupingAgent({ maxPages: config.maxImagePagesPerCandidate });
const excelAgent = createExcelAgent();
const workLimiter = new WorkLimiter({
  concurrency: config.processingConcurrency,
  maxWeight: config.maxInFlightBytes
});
const cacheLimiter = new WorkLimiter({
  concurrency: config.cacheConcurrency,
  maxWeight: config.cacheConcurrency
});
const cvAgent = createCvAgent({
  config,
  cacheAgent,
  inputRouter,
  openAiAgent,
  cacheLimiter,
  workLimiter
});
let jobProcessor;
const historyAgent = createHistoryAgent({
  config,
  getLiveJobs: () => (jobProcessor ? [...jobProcessor.jobs.values()] : [])
});
jobProcessor = createJobProcessor({
  config,
  cvAgent,
  groupingAgent,
  excelAgent,
  storageAgent,
  bitrixAgent
});
const archiveAgent = createArchiveAgent({ config, historyAgent });
const uploadMiddleware = createUploadMiddleware({ config, storageAgent, jobProcessor });

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(config.projectRoot, 'public')));

app.get('/api/health', (_req, res) => {
  const aiLane = workLimiter.stats();
  const cacheLane = cacheLimiter.stats();
  res.json({
    ok: true,
    mode: 'dual-lane-bounded-parallel-queue',
    n8nWebhookConfigured: Boolean(process.env.N8N_WEBHOOK_URL),
    model: config.openAiModel,
    maxFiles: config.maxFiles,
    maxFileSizeMb: config.maxFileSizeMb,
    maxImagePagesPerCandidate: config.maxImagePagesPerCandidate,
    processingConcurrency: config.processingConcurrency,
    cacheConcurrency: config.cacheConcurrency,
    processingWindow: config.processingWindow,
    maxInFlightMb: config.maxInFlightMb,
    activeWorkers: aiLane.active,
    queuedWorkers: aiLane.queued,
    peakWorkers: aiLane.peakActive,
    activeAiWorkers: aiLane.active,
    queuedAiWorkers: aiLane.queued,
    peakAiWorkers: aiLane.peakActive,
    activeCacheWorkers: cacheLane.active,
    queuedCacheWorkers: cacheLane.queued,
    peakCacheWorkers: cacheLane.peakActive,
    candidateHistory: true,
    storageDir: path.relative(config.projectRoot, config.storageRoot)
  });
});

app.post('/api/batches', requireOpenAiKey, async (req, res) => {
  try {
    const batch = storageAgent.createBatch();
    const stageId = safeString(req.body.stageId || req.body.bitrixStage).trim() || 'DT1156_44:NEW';
    const job = jobProcessor.createJob({
      batchId: batch.batchId,
      batchDir: batch.batchDir,
      files: [],
      appliedPost: safeString(req.body.appliedPost).slice(0, 200),
      stageId,
      expectedTotal: expectedTotal(req.body.expectedTotal),
      uploadComplete: false
    });
    await jobProcessor.save(job, true);
    res.status(201).json(jobProcessor.publicJob(job));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Could not create upload batch.' });
  }
});

app.post(
  '/api/batches/:jobId/files',
  uploadMiddleware.attachExistingBatch,
  uploadMiddleware.handleSingleCvUpload,
  async (req, res) => {
    try {
      const files = await storageAgent.normalizeFiles(req.file ? [req.file] : []);
      if (!files.length) {
        return res.status(400).json({ error: 'No CV file was uploaded.' });
      }

      const [file] = files;
      if (req.job.fileHashes.has(file.hash)) {
        await storageAgent.removeStoredFile(file);
        await jobProcessor.recordDuplicate(req.job, file.originalname);
        return res.json(jobProcessor.publicJob(req.job));
      }

      await jobProcessor.addFile(req.job, file);
      res.status(202).json(jobProcessor.publicJob(req.job));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Could not upload CV file.' });
    }
  }
);

app.post('/api/batches/:jobId/skip-file', async (req, res) => {
  const job = jobProcessor.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }
  if (!jobProcessor.canAcceptUploads(job)) {
    return res.status(409).json({ error: 'This job is no longer accepting uploads.' });
  }

  try {
    await jobProcessor.addSkippedFile(job, {
      originalname: req.body.originalname,
      size: req.body.size,
      error: req.body.error
    });
    res.json(jobProcessor.publicJob(job));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not record skipped file.' });
  }
});

app.post('/api/batches/:jobId/start', async (req, res) => {
  const job = jobProcessor.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  try {
    await jobProcessor.markUploadComplete(job);
    res.json(jobProcessor.publicJob(job));
  } catch (error) {
    res.status(409).json({ error: error.message || 'Could not start CV processing.' });
  }
});

app.post(
  '/api/extract',
  requireOpenAiKey,
  uploadMiddleware.createBatchContext,
  uploadMiddleware.uploadArray,
  handleBulkUpload
);

app.post(
  '/api/process-cvs',
  requireOpenAiKey,
  requireWorkflowSecret,
  uploadMiddleware.createBatchContext,
  uploadMiddleware.uploadArray,
  handleBulkUpload
);

app.get('/api/candidates', async (req, res) => {
  try {
    res.json(
      await historyAgent.list({
        search: req.query.search,
        page: req.query.page,
        pageSize: req.query.pageSize
      })
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Could not load candidate history.' });
  }
});

app.get('/api/candidates/download-range', async (req, res) => {
  try {
    const candidates = await historyAgent.selectRange({
      search: req.query.search,
      from: Number(req.query.from),
      to: Number(req.query.to)
    });
    await archiveAgent.streamCandidates(
      res,
      candidates,
      `cv-range-${req.query.from}-${req.query.to}-${new Date().toISOString().slice(0, 10)}.zip`
    );
  } catch (error) {
    sendDownloadError(res, error, 'Could not download this candidate range.');
  }
});

app.get('/api/candidates/:candidateId/download', async (req, res) => {
  try {
    const candidate = await historyAgent.getCandidate(req.params.candidateId);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found.' });
    }
    await archiveAgent.sendCandidate(res, candidate);
  } catch (error) {
    sendDownloadError(res, error, 'Could not download this CV.');
  }
});

app.get('/api/crm/status', async (_req, res) => {
  try {
    const configured = bitrixAgent.isConfigured();
    let conn = { ok: false };
    let stages = [];
    if (configured) {
      conn = await bitrixAgent.testConnection();
      stages = await bitrixAgent.getStages();
    }
    res.json({
      configured,
      connected: conn.ok,
      user: conn.user || null,
      entityTypeId: config.bitrixEntityTypeId,
      stages
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not check Bitrix24 CRM status.' });
  }
});

app.get('/api/crm/stages', async (_req, res) => {
  try {
    const stages = await bitrixAgent.getStages();
    res.json({ ok: true, stages });
  } catch (error) {
    res.json({ ok: false, stages: [] });
  }
});

app.post('/api/candidates/:candidateId/sync-crm', async (req, res) => {
  try {
    const candidate = await historyAgent.getCandidate(req.params.candidateId);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found.' });
    }
    const stageId = safeString(req.body.stageId || req.body.bitrixStage).trim() || undefined;
    const files = await historyAgent.resolveCandidateFiles(candidate);
    const filePath = files.length > 0 ? files[0].path : null;
    const result = await bitrixAgent.pushCandidate(candidate, { filePath, stageId });
    if (!result.success) {
      return res.status(400).json({ error: result.error || 'Failed to sync candidate to Bitrix24 CRM.' });
    }
    res.json({ ok: true, candidateId: candidate.id, crmId: result.crmId, stageId: result.stageId });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not sync candidate to Bitrix24 CRM.' });
  }
});

app.post('/api/crm/sync-all', async (req, res) => {
  if (!bitrixAgent.isConfigured()) {
    return res.status(400).json({ error: 'BITRIX24_WEBHOOK_URL is not configured.' });
  }

  const stageId = safeString(req.body.stageId || req.body.bitrixStage).trim() || 'DT1156_44:NEW';

  // Trigger sync in background
  setImmediate(async () => {
    try {
      const { spawn } = await import('node:child_process');
      const scriptPath = path.join(config.projectRoot, 'scripts', 'sync-all-to-crm.js');
      const child = spawn(process.execPath, [scriptPath, stageId], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    } catch (err) {
      console.error('Failed to launch sync-all-to-crm process:', err);
    }
  });

  res.json({ ok: true, message: 'Bulk CRM sync initiated in background.' });
});

app.get('/api/jobs/:jobId', async (req, res) => {
  const job = jobProcessor.getJob(req.params.jobId);
  if (job) {
    return res.json(jobProcessor.publicJob(job));
  }

  const persisted = await storageAgent.readPersistedJob(req.params.jobId);
  if (!persisted) {
    return res.status(404).json({ error: 'Job not found.' });
  }
  res.json(persisted);
});

app.get('/api/jobs/:jobId/download', async (req, res) => {
  const job = jobProcessor.getJob(req.params.jobId);
  let excelPath = job?.excelPath;
  let downloadFileName = job?.downloadFileName;

  if (!job) {
    const persisted = await storageAgent.readPersistedJob(req.params.jobId);
    if (persisted) {
      downloadFileName = path.basename(persisted.downloadFileName || 'cv-extraction.xlsx');
      excelPath = path.join(config.batchesRoot, req.params.jobId, downloadFileName);
    }
  }

  if (!excelPath || !downloadFileName) {
    return res.status(404).json({ error: 'Job not found.' });
  }
  if (!fs.existsSync(excelPath)) {
    return res.status(409).json({ error: 'Excel file is not ready yet.' });
  }
  res.download(excelPath, downloadFileName);
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: uploadMiddleware.multerErrorMessage(error) });
  }
  console.error(error);
  res.status(500).json({ error: error.message || 'Unexpected server error.' });
});

async function handleBulkUpload(req, res) {
  try {
    const normalized = await storageAgent.normalizeFiles(req.files || []);
    const deduplicated = await storageAgent.removeDuplicateFiles(normalized);
    if (!deduplicated.files.length) {
      return res.status(400).json({ error: 'No CV files were uploaded.' });
    }

    const stageId = safeString(req.body.stageId || req.body.bitrixStage).trim() || 'DT1156_44:NEW';
    const job = jobProcessor.createJob({
      batchId: req.batchId,
      batchDir: req.batchDir,
      files: deduplicated.files,
      appliedPost: safeString(req.body.appliedPost).slice(0, 200),
      stageId,
      expectedTotal: deduplicated.files.length,
      uploadComplete: true,
      duplicates: deduplicated.duplicates
    });
    jobProcessor.ensureRunning(job);

    if (req.query.sync === '1') {
      await jobProcessor.waitForCompletion(job);
      return res.json(jobProcessor.result(job));
    }

    res.status(202).json(jobProcessor.publicJob(job));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'CV processing failed.' });
  }
}

function requireOpenAiKey(_req, res, next) {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY is missing in .env.' });
  }
  next();
}

function requireWorkflowSecret(req, res, next) {
  if (req.get('x-workflow-secret') !== config.workflowSecret) {
    return res.status(401).json({ error: 'Invalid workflow secret.' });
  }
  next();
}

function expectedTotal(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(config.maxFiles, Math.max(0, Math.trunc(number)));
}

function sendDownloadError(res, error, fallbackMessage) {
  const status = Number(error.statusCode) || 500;
  if (status >= 500) console.error(error);
  if (res.headersSent) {
    res.destroy(error);
    return;
  }
  res.status(status).json({ error: error.message || fallbackMessage });
}

let server;
if (isMainModule(currentFile)) {
  server = app.listen(config.port, () => {
    console.log(
      `CV Auto running on http://localhost:${config.port} with ${config.cacheConcurrency} cache workers and up to ${config.processingConcurrency} AI workers`
    );
  });
}

export { app, cacheLimiter, config, historyAgent, jobProcessor, storageAgent, workLimiter, server };
