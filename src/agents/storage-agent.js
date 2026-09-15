import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { dateStamp, mimeFromName } from '../lib/utils.js';

export function createStorageAgent(config) {
  const snapshotQueues = new Map();

  fs.mkdirSync(config.batchesRoot, { recursive: true });
  fs.mkdirSync(config.cacheRoot, { recursive: true });

  function createBatch() {
    const batchId = `${dateStamp()}-${crypto.randomUUID().slice(0, 8)}`;
    const batchDir = path.join(config.batchesRoot, batchId);
    const originalsDir = path.join(batchDir, 'originals');
    fs.mkdirSync(originalsDir, { recursive: true });
    return { batchId, batchDir, originalsDir };
  }

  async function normalizeFiles(files = []) {
    const normalized = [];
    for (const file of files) {
      normalized.push({
        originalname: file.originalname,
        storedName: path.basename(file.filename),
        mimetype: file.mimetype || mimeFromName(file.originalname),
        path: file.path,
        size: Number(file.size || 0),
        hash: await hashFile(file.path)
      });
    }
    return normalized;
  }

  async function removeDuplicateFiles(files) {
    const hashes = new Set();
    const uniqueFiles = [];
    let duplicates = 0;

    for (const file of files) {
      if (hashes.has(file.hash)) {
        duplicates += 1;
        await removeStoredFile(file);
      } else {
        hashes.add(file.hash);
        uniqueFiles.push(file);
      }
    }

    return { files: uniqueFiles, duplicates };
  }

  async function removeStoredFile(file) {
    if (file?.path) {
      await fsp.unlink(file.path).catch(() => {});
    }
  }

  function saveSnapshot(job, snapshot) {
    const previous = snapshotQueues.get(job.id) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      await fsp.mkdir(job.batchDir, { recursive: true });
      const snapshotPath = path.join(job.batchDir, 'results.json');
      const temporaryPath = `${snapshotPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fsp.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

      try {
        await fsp.rename(temporaryPath, snapshotPath);
      } catch (error) {
        if (!['EEXIST', 'EPERM'].includes(error.code)) {
          await fsp.rm(temporaryPath, { force: true }).catch(() => {});
          throw error;
        }
        await fsp.rm(snapshotPath, { force: true });
        await fsp.rename(temporaryPath, snapshotPath);
      }
    });

    snapshotQueues.set(job.id, next);
    const cleanup = () => {
      if (snapshotQueues.get(job.id) === next) snapshotQueues.delete(job.id);
    };
    next.then(cleanup, cleanup);
    return next;
  }

  async function readPersistedJob(jobId) {
    if (!/^[a-zA-Z0-9T-]+$/.test(jobId)) {
      return null;
    }

    try {
      const snapshotPath = path.join(config.batchesRoot, jobId, 'results.json');
      return JSON.parse(await fsp.readFile(snapshotPath, 'utf8'));
    } catch {
      return null;
    }
  }

  return {
    createBatch,
    normalizeFiles,
    removeDuplicateFiles,
    removeStoredFile,
    saveSnapshot,
    readPersistedJob
  };
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
