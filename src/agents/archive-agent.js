import path from 'node:path';

import { ZipArchive } from 'archiver';

import { dateStamp, sanitizeFileName } from '../lib/utils.js';

export function createArchiveAgent({ config, historyAgent }) {
  async function sendCandidate(res, candidate) {
    const files = await historyAgent.resolveCandidateFiles(candidate);
    if (!files.length) {
      const error = new Error('The original CV file is no longer available.');
      error.statusCode = 404;
      throw error;
    }

    if (files.length === 1) {
      return new Promise((resolve, reject) => {
        res.download(files[0].path, files[0].downloadName, (error) => (error ? reject(error) : resolve()));
      });
    }

    return streamCandidates(res, [candidate], `cv-${sanitizeFileName(candidate.name)}-${dateStamp()}.zip`);
  }

  async function streamCandidates(res, candidates, filename = `cv-range-${dateStamp()}.zip`) {
    if (!candidates.length) {
      const error = new Error('No candidates were selected for download.');
      error.statusCode = 400;
      throw error;
    }
    if (candidates.length > config.maxHistoryDownloadCandidates) {
      const error = new Error(`A single archive can contain up to ${config.maxHistoryDownloadCandidates} candidates.`);
      error.statusCode = 413;
      throw error;
    }

    const { entries, missing, totalBytes } = await prepareEntries(candidates);
    if (!entries.length) {
      const error = new Error('None of the selected original CV files are available.');
      error.statusCode = 404;
      throw error;
    }
    if (totalBytes > config.maxHistoryArchiveMb * 1024 * 1024) {
      const error = new Error(
        `Selected files exceed the ${config.maxHistoryArchiveMb} MB archive limit. Choose a smaller range.`
      );
      error.statusCode = 413;
      throw error;
    }

    const safeFilename = sanitizeFileName(filename.endsWith('.zip') ? filename : `${filename}.zip`);
    res.status(200);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);

    const archive = new ZipArchive({
      zlib: { level: 1, memLevel: 3 },
      statConcurrency: 1,
      highWaterMark: 256 * 1024
    });
    archive.on('warning', (error) => {
      if (error.code !== 'ENOENT') console.warn('Archive warning:', error);
    });
    const archiveError = new Promise((_, reject) => archive.once('error', reject));
    res.once('close', () => {
      if (!res.writableEnded) archive.abort();
    });
    archive.pipe(res);

    for (const entry of entries) {
      archive.file(entry.path, {
        name: entry.archiveName,
        store: /\.(?:pdf|png|jpe?g|webp|zip|docx|xlsx)$/i.test(entry.archiveName)
      });
    }
    if (missing.length) {
      archive.append(`${missing.join('\n')}\n`, { name: 'missing-files.txt' });
    }

    await Promise.race([archive.finalize(), archiveError]);
  }

  async function prepareEntries(candidates) {
    const entries = [];
    const missing = [];
    const usedNames = new Set();
    let totalBytes = 0;

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const files = await historyAgent.resolveCandidateFiles(candidate);
      if (!files.length) {
        missing.push(`${index + 1}. ${candidate.name} (${candidate.batchId})`);
        continue;
      }

      const position = candidate.selectionPosition || index + 1;
      const folder = `${String(position).padStart(4, '0')}-${sanitizeFileName(candidate.name || 'candidate')}`;
      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const file = files[fileIndex];
        const prefixedName = files.length > 1 ? `${String(fileIndex + 1).padStart(2, '0')}-${file.downloadName}` : file.downloadName;
        const archiveName = uniqueArchiveName(path.posix.join(folder, prefixedName), usedNames);
        entries.push({ ...file, archiveName });
        totalBytes += file.size;
      }
    }

    return { entries, missing, totalBytes };
  }

  return { sendCandidate, streamCandidates, prepareEntries };
}

function uniqueArchiveName(value, usedNames) {
  let candidate = value;
  let suffix = 2;
  const parsed = path.posix.parse(value);
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = path.posix.join(parsed.dir, `${parsed.name}-${suffix}${parsed.ext}`);
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}
