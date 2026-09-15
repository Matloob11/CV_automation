import assert from 'node:assert/strict';
import test from 'node:test';

import { createCvAgent } from '../src/agents/cv-agent.js';
import { delay } from '../src/lib/utils.js';
import { candidateFields } from '../src/schema.js';
import { WorkLimiter } from '../src/queue/work-limiter.js';

test('cache and OpenAI work use independent 20/10 concurrency lanes', async () => {
  const config = {
    maxInFlightBytes: 500 * 1024 * 1024,
    maxPromptTextChars: 50000
  };
  const cacheLimiter = new WorkLimiter({ concurrency: 20, maxWeight: 20 });
  const workLimiter = new WorkLimiter({
    concurrency: 10,
    maxWeight: config.maxInFlightBytes
  });
  let activeCacheReads = 0;
  let peakCacheReads = 0;
  let activeAiCalls = 0;
  let peakAiCalls = 0;

  const cacheAgent = {
    async read(file) {
      activeCacheReads += 1;
      peakCacheReads = Math.max(peakCacheReads, activeCacheReads);
      await delay(20);
      activeCacheReads -= 1;
      return file.originalname.startsWith('cached-') ? extraction(file.originalname) : null;
    },
    async write() {},
    key(file) {
      return file.hash;
    }
  };
  const inputRouter = {
    async prepare(file) {
      return { input: file.originalname };
    }
  };
  const openAiAgent = {
    async extract(fileName) {
      activeAiCalls += 1;
      peakAiCalls = Math.max(peakAiCalls, activeAiCalls);
      await delay(35);
      activeAiCalls -= 1;
      return extraction(fileName);
    }
  };
  const cvAgent = createCvAgent({
    config,
    cacheAgent,
    inputRouter,
    openAiAgent,
    cacheLimiter,
    workLimiter
  });
  const files = [
    ...Array.from({ length: 20 }, (_, index) => file(`cached-${index}.pdf`)),
    ...Array.from({ length: 20 }, (_, index) => file(`new-${index}.pdf`))
  ];

  const rows = await Promise.all(files.map((fileValue) => cvAgent.process(fileValue)));

  assert.equal(rows.length, 40);
  assert.equal(rows.filter((row) => row.cacheHit === 'yes').length, 20);
  assert.equal(rows.filter((row) => row.status === 'ok').length, 40);
  assert.equal(peakCacheReads, 20);
  assert.equal(peakAiCalls, 10);
  assert.equal(cacheLimiter.stats().active, 0);
  assert.equal(workLimiter.stats().active, 0);
});

function file(originalname) {
  return {
    originalname,
    storedName: originalname,
    mimetype: 'application/pdf',
    size: 100,
    hash: originalname,
    path: originalname
  };
}

function extraction(name) {
  const row = Object.fromEntries(candidateFields.map((field) => [field, '']));
  row.name = name;
  row.email = 'candidate@example.com';
  row.designation = 'Candidate';
  row.summary = `${name} profile`;
  return {
    ...row,
    isResume: true,
    rejectionReason: '',
    isContinuationPage: false,
    continuationConfidence: 0,
    pageNumber: 0,
    confidence: 0.9,
    missingFields: [],
    inferredFields: ['summary']
  };
}
