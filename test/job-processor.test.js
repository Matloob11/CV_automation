import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createGroupingAgent } from '../src/agents/grouping-agent.js';
import { delay } from '../src/lib/utils.js';
import { createJobProcessor } from '../src/queue/job-processor.js';
import { WorkLimiter } from '../src/queue/work-limiter.js';

test('job processor extracts five files concurrently and flushes/group pages in source order', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cv-auto-job-'));
  const batchDir = path.join(root, 'batch');
  const delays = [80, 8, 25, 5, 15];
  const rows = [
    okRow({ name: 'Ali Khan', email: 'ali@example.com', source: 'Ali-page-1.jpg' }),
    okRow({
      name: '',
      education: 'MBA',
      source: 'Ali-page-2.jpg',
      isContinuationPage: true,
      continuationConfidence: 0.98,
      pageNumber: 2
    }),
    okRow({ name: 'Sara Noor', email: 'sara@example.com', source: 'Sara-page-1.jpg' }),
    failedRow('not-a-cv.pdf'),
    okRow({ name: 'Usman Raza', email: 'usman@example.com', source: 'Usman.txt' })
  ];
  const files = [
    file('Ali-page-1.jpg', 'image/jpeg'),
    file('Ali-page-2.jpg', 'image/jpeg'),
    file('Sara-page-1.jpg', 'image/jpeg'),
    file('not-a-cv.pdf', 'application/pdf'),
    file('Usman.txt', 'text/plain')
  ];

  const cvAgent = {
    async process(fileValue) {
      const index = files.indexOf(fileValue);
      await delay(delays[index]);
      return rows[index];
    },
    failedUploadRow({ originalname, error }) {
      return { ...failedRow(originalname), error, summary: error };
    }
  };
  const config = {
    processingConcurrency: 5,
    maxInFlightBytes: 100 * 1024 * 1024,
    projectRoot: root
  };
  const storageAgent = { async saveSnapshot() {} };
  const excelAgent = {
    async build(_resultRows, destination) {
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.writeFile(destination, 'excel');
    }
  };
  const processor = createJobProcessor({
    config,
    workLimiter: new WorkLimiter({ concurrency: 5, maxWeight: config.maxInFlightBytes }),
    cvAgent,
    groupingAgent: createGroupingAgent({ maxPages: 3 }),
    excelAgent,
    storageAgent
  });
  const job = processor.createJob({
    batchId: 'test-batch',
    batchDir,
    files,
    uploadComplete: true
  });

  processor.ensureRunning(job);
  await processor.waitForCompletion(job);

  assert.equal(job.status, 'completed');
  assert.equal(job.peakWorkers, 5);
  assert.equal(job.processedFiles, 5);
  assert.equal(job.groupedPages, 1);
  assert.equal(job.succeeded, 3);
  assert.equal(job.failed, 1);
  assert.equal(job.rows.length, 4);
  assert.equal(job.rows[0].name, 'Ali Khan');
  assert.equal(job.rows[0].pageCount, 2);
  assert.equal(job.rows[0].education, 'MBA');
  assert.equal(job.rows[1].name, 'Sara Noor');
  assert.equal(job.rows[2].status, 'failed');
  assert.equal(job.rows[3].name, 'Usman Raza');

  await fsp.rm(root, { recursive: true, force: true });
});

test('file progress advances while an out-of-order row waits for ordered commit', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cv-auto-progress-'));
  const files = [file('slow-first.pdf', 'application/pdf'), file('fast-second.pdf', 'application/pdf')];
  const cvAgent = {
    async process(fileValue) {
      await delay(fileValue === files[0] ? 80 : 5);
      return okRow({ name: fileValue.originalname, source: fileValue.originalname });
    },
    failedUploadRow({ originalname, error }) {
      return { ...failedRow(originalname), error, summary: error };
    }
  };
  const processor = createJobProcessor({
    config: { processingConcurrency: 2, maxInFlightBytes: 1024, projectRoot: root },
    cvAgent,
    groupingAgent: createGroupingAgent({ maxPages: 3 }),
    excelAgent: { async build() {} },
    storageAgent: { async saveSnapshot() {} }
  });
  const job = processor.createJob({ batchId: 'progress-batch', batchDir: root, files, uploadComplete: true });

  processor.ensureRunning(job);
  await delay(25);

  assert.equal(job.processedFiles, 1);
  assert.equal(job.rows.length, 0);

  await processor.waitForCompletion(job);
  assert.equal(job.processedFiles, 2);
  assert.equal(job.rows.length, 2);
  await fsp.rm(root, { recursive: true, force: true });
});

function file(originalname, mimetype) {
  return { originalname, mimetype, storedName: originalname, size: 100, hash: originalname, path: originalname };
}

function okRow({
  name,
  email = '',
  education = '',
  source,
  isContinuationPage = false,
  continuationConfidence = 0,
  pageNumber = 1
}) {
  return {
    sourceFile: source,
    sourceFiles: [source],
    storedFile: source,
    storedFiles: [source],
    pageCount: 1,
    name,
    phoneNumber: '',
    email,
    gender: '',
    dateOfBirth: '',
    address: '',
    designation: '',
    appliedPost: '',
    city: '',
    summary: `${name || 'Candidate'} profile`,
    skills: '',
    totalExperienceYears: '',
    education,
    isResume: true,
    rejectionReason: '',
    isContinuationPage,
    continuationConfidence,
    pageNumber,
    confidence: 0.9,
    missingFields: '',
    inferredFields: ['summary'],
    cacheHit: 'no',
    status: 'ok',
    error: ''
  };
}

function failedRow(source) {
  return {
    ...okRow({ name: source, source }),
    isResume: false,
    rejectionReason: 'Not a CV',
    status: 'failed',
    summary: 'Not a CV',
    error: 'Not a CV'
  };
}
