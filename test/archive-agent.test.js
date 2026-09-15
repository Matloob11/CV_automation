import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { createArchiveAgent } from '../src/agents/archive-agent.js';

test('archive agent streams selected CV files as a ZIP response', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cv-auto-archive-'));
  const cvPath = path.join(root, 'candidate.txt');
  await fsp.writeFile(cvPath, 'candidate cv content');

  const historyAgent = {
    async resolveCandidateFiles() {
      return [{ path: cvPath, size: 20, downloadName: 'candidate.txt' }];
    }
  };
  const archiveAgent = createArchiveAgent({
    config: { maxHistoryDownloadCandidates: 10, maxHistoryArchiveMb: 100 },
    historyAgent
  });
  const app = express();
  app.get('/archive', async (_req, res) => {
    try {
      await archiveAgent.streamCandidates(
        res,
        [{ name: 'Test Candidate', batchId: 'batch', selectionPosition: 1 }],
        'selected-cvs.zip'
      );
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ error: error.message });
    }
  });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/archive`);
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.match(response.headers.get('content-disposition'), /selected-cvs\.zip/);
    assert.equal(buffer.subarray(0, 2).toString(), 'PK');
    assert.match(buffer.toString('latin1'), /0001-Test Candidate\/candidate\.txt/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fsp.rm(root, { recursive: true, force: true });
  }
});
