import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createHistoryAgent } from '../src/agents/history-agent.js';

test('history agent loads past rows, overlays live jobs, searches, ranges, and resolves originals', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cv-auto-history-'));
  const batchesRoot = path.join(root, 'cv-batches');
  const batchId = '2026-07-13T10-00-00-history';
  const batchDir = path.join(batchesRoot, batchId);
  await fsp.mkdir(path.join(batchDir, 'originals'), { recursive: true });
  await fsp.writeFile(path.join(batchDir, 'originals', '00001-alice.pdf'), 'alice cv');
  await fsp.writeFile(
    path.join(batchDir, 'results.json'),
    JSON.stringify({
      jobId: batchId,
      status: 'completed',
      startedAt: '2026-07-13T10:00:00.000Z',
      completedAt: '2026-07-13T10:01:00.000Z',
      rows: [
        candidateRow({
          name: 'Alice Khan',
          email: 'alice@example.com',
          designation: 'Sales Executive',
          city: 'Lahore',
          storedFile: '00001-alice.pdf',
          sourceFile: 'alice.pdf'
        }),
        { status: 'failed', name: 'invoice.pdf' }
      ]
    })
  );

  const liveJobs = [];
  const config = {
    batchesRoot,
    historyCacheMs: 60000,
    historyDefaultPageSize: 25,
    historyMaxPageSize: 100,
    maxHistoryDownloadCandidates: 500
  };
  const agent = createHistoryAgent({ config, getLiveJobs: () => liveJobs });

  const initial = await agent.list({ search: 'sales Lahore', page: 1, pageSize: 25 });
  assert.equal(initial.total, 1);
  assert.equal(initial.items[0].name, 'Alice Khan');
  assert.match(initial.items[0].downloadUrl, /^\/api\/candidates\//);

  const storedCandidate = await agent.getCandidate(initial.items[0].id);
  const files = await agent.resolveCandidateFiles(storedCandidate);
  assert.equal(files.length, 1);
  assert.equal(files[0].downloadName, 'alice.pdf');

  liveJobs.push({
    id: '2026-07-13T11-00-00-live',
    status: 'processing',
    startedAt: '2026-07-13T11:00:00.000Z',
    rows: [candidateRow({ name: 'Bob Noor', designation: 'Designer', sourceFile: 'bob.txt' })]
  });
  const withLive = await agent.list({ pageSize: 25 });
  assert.equal(withLive.total, 2);
  assert.equal(withLive.items[0].name, 'Bob Noor');

  const range = await agent.selectRange({ from: 1, to: 2 });
  assert.equal(range.length, 2);
  assert.equal(range[0].selectionPosition, 1);

  await fsp.rm(root, { recursive: true, force: true });
});

function candidateRow({
  name,
  email = '',
  designation = '',
  city = '',
  storedFile = '',
  sourceFile = ''
}) {
  return {
    status: 'ok',
    name,
    email,
    phoneNumber: '',
    designation,
    appliedPost: designation,
    city,
    education: '',
    skills: '',
    totalExperienceYears: '',
    sourceFile,
    sourceFiles: sourceFile ? [sourceFile] : [],
    storedFile,
    storedFiles: storedFile ? [storedFile] : []
  };
}
