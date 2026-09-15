import fsp from 'node:fs/promises';
import path from 'node:path';

import { safeString, sanitizeFileName, uniqueStrings } from '../lib/utils.js';
import { hasUsableCandidateDetails } from './candidate-policy.js';

export function createHistoryAgent({ config, getLiveJobs = () => [] }) {
  let persistedCache = { loadedAt: 0, candidates: [] };

  async function list({ search = '', page = 1, pageSize = config.historyDefaultPageSize } = {}) {
    const allCandidates = await getAllCandidates();
    const candidates = filterCandidates(allCandidates, search);
    const normalizedPageSize = Math.trunc(
      Math.min(config.historyMaxPageSize, Math.max(10, Number(pageSize) || config.historyDefaultPageSize))
    );
    const totalPages = Math.max(1, Math.ceil(candidates.length / normalizedPageSize));
    const normalizedPage = Math.trunc(Math.min(totalPages, Math.max(1, Number(page) || 1)));
    const offset = (normalizedPage - 1) * normalizedPageSize;
    const items = candidates.slice(offset, offset + normalizedPageSize).map((candidate, index) => ({
      ...toPublicCandidate(candidate),
      position: offset + index + 1
    }));

    return {
      items,
      total: candidates.length,
      totalAll: allCandidates.length,
      batchCount: new Set(candidates.map((candidate) => candidate.batchId)).size,
      page: normalizedPage,
      pageSize: normalizedPageSize,
      totalPages,
      maxDownloadCandidates: config.maxHistoryDownloadCandidates,
      search: normalizeSearch(search),
      updatedAt: new Date().toISOString()
    };
  }

  async function selectRange({ search = '', from, to }) {
    const candidates = filterCandidates(await getAllCandidates(), search);
    const start = Number(from);
    const end = Number(to);

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > candidates.length) {
      const error = new Error(`Choose a valid range between 1 and ${candidates.length}.`);
      error.statusCode = 400;
      throw error;
    }

    const count = end - start + 1;
    if (count > config.maxHistoryDownloadCandidates) {
      const error = new Error(
        `A single archive can contain up to ${config.maxHistoryDownloadCandidates} candidates. Choose a smaller range.`
      );
      error.statusCode = 413;
      throw error;
    }

    return candidates.slice(start - 1, end).map((candidate, index) => ({
      ...candidate,
      selectionPosition: start + index
    }));
  }

  async function getCandidate(candidateId) {
    const decoded = decodeCandidateId(candidateId);
    if (!decoded) return null;

    const liveJob = getLiveJobs().find((job) => job.id === decoded.batchId);
    if (liveJob) {
      return buildCandidate(liveJob, liveJob.rows?.[decoded.rowIndex], decoded.rowIndex);
    }

    try {
      const snapshot = JSON.parse(
        await fsp.readFile(path.join(config.batchesRoot, decoded.batchId, 'results.json'), 'utf8')
      );
      return buildCandidate(snapshot, snapshot.rows?.[decoded.rowIndex], decoded.rowIndex);
    } catch {
      return null;
    }
  }

  async function resolveCandidateFiles(candidate) {
    if (!candidate) return [];
    const originalsDir = path.join(config.batchesRoot, candidate.batchId, 'originals');
    const files = [];

    for (let index = 0; index < candidate._storedFiles.length; index += 1) {
      const storedName = path.basename(candidate._storedFiles[index]);
      if (!storedName) continue;
      const filePath = path.join(originalsDir, storedName);

      try {
        const stat = await fsp.stat(filePath);
        if (!stat.isFile()) continue;
        const sourceName = candidate.sourceFiles[index] || candidate.sourceFile || storedName;
        files.push({
          path: filePath,
          size: stat.size,
          downloadName: sanitizeFileName(path.basename(sourceName.replaceAll('\\', '/'))) || storedName
        });
      } catch {
        // A missing original should not hide the candidate history row.
      }
    }

    return files;
  }

  async function getAllCandidates() {
    const persisted = await loadPersistedCandidates();
    const merged = new Map(persisted.map((candidate) => [candidate.id, candidate]));

    for (const job of getLiveJobs()) {
      for (let rowIndex = 0; rowIndex < (job.rows?.length || 0); rowIndex += 1) {
        const candidate = buildCandidate(job, job.rows[rowIndex], rowIndex);
        if (candidate) merged.set(candidate.id, candidate);
      }
    }

    return [...merged.values()].sort(compareCandidates);
  }

  async function loadPersistedCandidates() {
    if (Date.now() - persistedCache.loadedAt < config.historyCacheMs) {
      return persistedCache.candidates;
    }

    let directories = [];
    try {
      directories = (await fsp.readdir(config.batchesRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    } catch {
      persistedCache = { loadedAt: Date.now(), candidates: [] };
      return [];
    }

    const snapshots = await mapWithConcurrency(directories, 8, async (directory) => {
      try {
        return JSON.parse(await fsp.readFile(path.join(config.batchesRoot, directory.name, 'results.json'), 'utf8'));
      } catch {
        return null;
      }
    });
    const candidates = [];
    for (const snapshot of snapshots.filter(Boolean)) {
      for (let rowIndex = 0; rowIndex < (snapshot.rows?.length || 0); rowIndex += 1) {
        const candidate = buildCandidate(snapshot, snapshot.rows[rowIndex], rowIndex);
        if (candidate) candidates.push(candidate);
      }
    }

    persistedCache = { loadedAt: Date.now(), candidates };
    return candidates;
  }

  function invalidate() {
    persistedCache.loadedAt = 0;
  }

  return {
    list,
    selectRange,
    getCandidate,
    resolveCandidateFiles,
    invalidate,
    encodeCandidateId,
    decodeCandidateId
  };
}

function buildCandidate(job, row, rowIndex) {
  if (!row || row.status !== 'ok' || !hasUsableCandidateDetails(row, row.sourceFile)) return null;
  const batchId = safeString(job.id || job.jobId);
  if (!/^[a-zA-Z0-9T-]+$/.test(batchId)) return null;

  const sourceFiles = uniqueStrings(
    Array.isArray(row.sourceFiles) && row.sourceFiles.length ? row.sourceFiles : [row.sourceFile]
  );
  const storedFiles = uniqueStrings(
    Array.isArray(row.storedFiles) && row.storedFiles.length ? row.storedFiles : [row.storedFile]
  );
  const rawPageCount = Number(row.pageCount || sourceFiles.length || 1);
  const candidate = {
    id: encodeCandidateId(batchId, rowIndex),
    batchId,
    rowIndex,
    batchStatus: safeString(job.status),
    processedAt: safeString(job.completedAt || job.startedAt),
    name: safeString(row.name) || 'Name not found',
    phoneNumber: safeString(row.phoneNumber),
    secondaryPhone: safeString(row.secondaryPhone),
    email: safeString(row.email),
    gender: safeString(row.gender),
    dateOfBirth: safeString(row.dateOfBirth),
    age: safeString(row.age),
    nationality: safeString(row.nationality),
    address: safeString(row.address),
    city: safeString(row.city),
    country: safeString(row.country),
    designation: safeString(row.designation),
    appliedPost: safeString(row.appliedPost),
    fieldOfExperience: safeString(row.fieldOfExperience),
    fieldOfStudy: safeString(row.fieldOfStudy),
    totalExperienceYears: safeString(row.totalExperienceYears || row.experienceYears),
    dubaiExperienceYears: safeString(row.dubaiExperienceYears),
    previousEmployers: safeString(row.previousEmployers),
    education: safeString(row.education),
    summary: safeString(row.summary),
    skills: safeString(row.skills),
    linkedin: safeString(row.linkedin),
    instagram: safeString(row.instagram),
    facebook: safeString(row.facebook),
    otherSocialLink: safeString(row.otherSocialLink),
    visaStatus: safeString(row.visaStatus),
    visaExpiryDate: safeString(row.visaExpiryDate),
    spouseVisa: safeString(row.spouseVisa),
    visaSponsorName: safeString(row.visaSponsorName),
    noticePeriod: safeString(row.noticePeriod),
    salaryExpectations: safeString(row.salaryExpectations),
    cvUrl: safeString(row.cvUrl),
    pageCount: Number.isFinite(rawPageCount) ? Math.max(1, Math.round(rawPageCount)) : 1,
    sourceFile: safeString(row.sourceFile) || sourceFiles.join(' | '),
    sourceFiles,
    hasDownload: storedFiles.length > 0,
    crmSynced: Boolean(row.crmSynced),
    crmId: row.crmId ? String(row.crmId) : '',
    crmStageId: safeString(row.crmStageId),
    _storedFiles: storedFiles
  };
  candidate._searchText = [
    candidate.name,
    candidate.phoneNumber,
    candidate.email,
    candidate.designation,
    candidate.appliedPost,
    candidate.nationality,
    candidate.visaStatus,
    candidate.city,
    candidate.country,
    candidate.address,
    candidate.education,
    candidate.skills,
    candidate.totalExperienceYears,
    candidate.previousEmployers,
    candidate.sourceFile,
    candidate.batchId
  ]
    .join(' ')
    .toLowerCase();
  return candidate;
}

function toPublicCandidate(candidate) {
  const { _storedFiles, _searchText, selectionPosition, ...publicCandidate } = candidate;
  return {
    ...publicCandidate,
    downloadUrl: candidate.hasDownload ? `/api/candidates/${candidate.id}/download` : ''
  };
}

function filterCandidates(candidates, search) {
  const terms = normalizeSearch(search)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return candidates;
  return candidates.filter((candidate) => terms.every((term) => candidate._searchText.includes(term)));
}

function normalizeSearch(search) {
  return safeString(search).slice(0, 200);
}

function compareCandidates(left, right) {
  const timeDifference = dateValue(right.processedAt) - dateValue(left.processedAt);
  if (timeDifference) return timeDifference;
  const batchDifference = right.batchId.localeCompare(left.batchId);
  return batchDifference || left.rowIndex - right.rowIndex;
}

function dateValue(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function encodeCandidateId(batchId, rowIndex) {
  return Buffer.from(`${batchId}:${rowIndex}`, 'utf8').toString('base64url');
}

function decodeCandidateId(candidateId) {
  if (!/^[a-zA-Z0-9_-]{4,240}$/.test(safeString(candidateId))) return null;
  try {
    const decoded = Buffer.from(candidateId, 'base64url').toString('utf8');
    const separator = decoded.lastIndexOf(':');
    const batchId = decoded.slice(0, separator);
    const rowIndex = Number(decoded.slice(separator + 1));
    if (!/^[a-zA-Z0-9T-]+$/.test(batchId) || !Number.isInteger(rowIndex) || rowIndex < 0) return null;
    return { batchId, rowIndex };
  } catch {
    return null;
  }
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}
