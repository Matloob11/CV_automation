import path from 'node:path';

import { dateStamp, errorMessage, mimeFromName, safeString } from '../lib/utils.js';
import { rejectUnusableCandidateRows } from '../agents/candidate-policy.js';

export function createJobProcessor({
  config,
  cvAgent,
  groupingAgent,
  excelAgent,
  storageAgent,
  bitrixAgent
}) {
  const jobs = new Map();
  const snapshotEveryFiles = Math.max(1, Number(config.snapshotEveryFiles || 5));
  const snapshotIntervalMs = Math.max(100, Number(config.snapshotIntervalMs || 1000));
  const processingWindow = Math.max(
    1,
    Number(config.processingWindow || config.processingConcurrency || 1)
  );

  function createJob({
    batchId,
    batchDir,
    files = [],
    appliedPost = '',
    stageId = 'DT1156_44:NEW',
    expectedTotal = files.length,
    uploadComplete = true,
    duplicates = 0
  }) {
    let resolveCompletion;
    const completionPromise = new Promise((resolve) => {
      resolveCompletion = resolve;
    });

    const job = {
      id: batchId,
      batchDir,
      files,
      appliedPost,
      stageId: safeString(stageId).trim() || 'DT1156_44:NEW',
      status: uploadComplete ? 'queued' : 'uploading',
      currentFile: '',
      processed: 0,
      processedFiles: 0,
      succeeded: 0,
      failed: 0,
      cacheHits: 0,
      groupedPages: 0,
      uploaded: files.filter((file) => !file.skipError).length,
      skipped: files.filter((file) => file.skipError).length,
      duplicates,
      total: Math.max(0, Number(expectedTotal || files.length)),
      nextFileIndex: 0,
      nextFlushIndex: 0,
      submittedTasks: 0,
      activeWorkers: 0,
      peakWorkers: 0,
      pendingResults: new Map(),
      pumpScheduled: false,
      finalizeStarted: false,
      uploadComplete,
      fileHashes: new Set(files.map((file) => file.hash).filter(Boolean)),
      imageGrouping: groupingAgent.createState(),
      rowsVersion: 0,
      rows: [],
      error: '',
      startedAt: new Date().toISOString(),
      completedAt: '',
      downloadFileName: `cv-extraction-${batchId}.xlsx`,
      excelPath: '',
      uploadSequence: files.length,
      lastSnapshotAt: 0,
      lastSnapshotActivity: -1,
      snapshotTimer: null,
      commitQueue: Promise.resolve(),
      completionPromise,
      resolveCompletion
    };

    jobs.set(job.id, job);
    return job;
  }

  function getJob(jobId) {
    return jobs.get(jobId);
  }

  function canAcceptUploads(job) {
    return Boolean(job && !job.uploadComplete && !['completed', 'failed'].includes(job.status));
  }

  async function addFile(job, file) {
    assertAcceptingUploads(job);
    job.files.push(file);
    if (file.hash) job.fileHashes.add(file.hash);
    job.uploaded += 1;
    job.total = Math.max(job.total, job.uploaded + job.skipped);
    job.currentFile = `Uploaded ${job.uploaded} of ${job.total}`;
    ensureRunning(job);
    await save(job);
  }

  async function addSkippedFile(job, { originalname, size = 0, error }) {
    assertAcceptingUploads(job);
    job.files.push({
      originalname: safeString(originalname) || 'Unknown file',
      storedName: '',
      mimetype: mimeFromName(originalname),
      path: '',
      size: Number(size || 0),
      hash: '',
      skipError: safeString(error) || 'File skipped.'
    });
    job.skipped += 1;
    job.total = Math.max(job.total, job.uploaded + job.skipped);
    job.currentFile = `Skipped ${safeString(originalname) || 'Unknown file'}`;
    ensureRunning(job);
    await save(job);
  }

  async function recordDuplicate(job, originalname) {
    assertAcceptingUploads(job);
    job.duplicates += 1;
    job.total = Math.max(job.uploaded + job.skipped, job.total - 1);
    job.currentFile = `Duplicate skipped: ${originalname}`;
    await save(job);
  }

  async function markUploadComplete(job) {
    if (!job || ['completed', 'failed'].includes(job.status)) {
      throw new Error('This job is no longer accepting changes.');
    }
    job.uploadComplete = true;
    job.total = Math.max(job.total, job.uploaded + job.skipped);
    ensureRunning(job);
    await save(job, true);
  }

  function ensureRunning(job) {
    if (!job || ['completed', 'failed'].includes(job.status) || job.finalizeStarted || job.pumpScheduled) {
      return;
    }

    job.pumpScheduled = true;
    setImmediate(() => {
      job.pumpScheduled = false;
      pump(job).catch((error) => failJob(job, error));
    });
  }

  async function pump(job) {
    if (['completed', 'failed'].includes(job.status) || job.finalizeStarted) {
      return;
    }

    while (job.submittedTasks < processingWindow && job.nextFileIndex < job.files.length) {
      const fileIndex = job.nextFileIndex;
      const file = job.files[fileIndex];
      job.nextFileIndex += 1;
      job.submittedTasks += 1;
      launchTask(job, fileIndex, file);
    }

    if (job.submittedTasks > 0 || job.nextFileIndex < job.files.length) {
      job.status = 'processing';
    } else if (!job.uploadComplete) {
      job.status = 'uploading';
      job.currentFile = `Uploaded ${job.uploaded} of ${job.total || job.uploaded}`;
    }

    if (isReadyToFinalize(job)) {
      startFinalization(job);
    }
  }

  function launchTask(job, fileIndex, file) {
    const task = (async () => {
      job.activeWorkers += 1;
      job.peakWorkers = Math.max(job.peakWorkers, job.activeWorkers);
      job.currentFile = `Processing ${file.originalname}`;
      try {
        return await cvAgent.process(file, job.appliedPost);
      } finally {
        job.activeWorkers = Math.max(0, job.activeWorkers - 1);
      }
    })();

    Promise.resolve(task).then(
      (row) => queueCompletion(job, fileIndex, file, row),
      (error) =>
        queueCompletion(
          job,
          fileIndex,
          file,
          cvAgent.failedUploadRow({
            originalname: file.originalname,
            appliedPost: job.appliedPost,
            error: errorMessage(error, 'Failed to process this CV.')
          })
        )
    );
  }

  function queueCompletion(job, fileIndex, file, row) {
    const operation = job.commitQueue
      .catch(() => {})
      .then(() => completeTask(job, fileIndex, file, row));

    job.commitQueue = operation
      .catch((error) => failJob(job, error))
      .catch((error) => console.error('Could not fail CV job cleanly:', error));
  }

  async function completeTask(job, fileIndex, file, row) {
    job.submittedTasks = Math.max(0, job.submittedTasks - 1);
    if (['completed', 'failed'].includes(job.status)) {
      return;
    }

    // File progress follows completed work; row commits remain ordered for image grouping.
    job.processedFiles += 1;
    job.pendingResults.set(fileIndex, { file, row });
    while (job.pendingResults.has(job.nextFlushIndex)) {
      const result = job.pendingResults.get(job.nextFlushIndex);
      job.pendingResults.delete(job.nextFlushIndex);
      const grouped = groupingAgent.addProcessedRow(job.rows, result.row, result.file, job.imageGrouping);
      job.groupedPages += grouped ? 1 : 0;
      job.rowsVersion += 1;
      job.nextFlushIndex += 1;
    }

    updateStats(job);
    if (job.submittedTasks > 0) {
      job.currentFile = `Processing ${job.submittedTasks} CV file${job.submittedTasks === 1 ? '' : 's'}`;
    } else if (job.nextFileIndex < job.files.length) {
      job.currentFile = 'Starting the next CV files';
    } else if (!job.uploadComplete) {
      job.status = 'uploading';
      job.currentFile = `Uploaded ${job.uploaded} of ${job.total || job.uploaded}`;
    } else {
      job.currentFile = 'Preparing Excel';
    }

    ensureRunning(job);
    await save(job);
  }

  function isReadyToFinalize(job) {
    return (
      job.uploadComplete &&
      job.nextFileIndex >= job.files.length &&
      job.submittedTasks === 0 &&
      job.pendingResults.size === 0 &&
      job.nextFlushIndex >= job.files.length
    );
  }

  function startFinalization(job) {
    if (job.finalizeStarted || ['completed', 'failed'].includes(job.status)) {
      return;
    }

    job.finalizeStarted = true;
    job.status = 'processing';
    job.currentFile = 'Preparing Excel';
    save(job, true).catch(() => {});

    setImmediate(async () => {
      try {
        const finalized = rejectUnusableCandidateRows(job.rows);
        if (finalized.rejected > 0) {
          job.rows = finalized.rows;
          job.rowsVersion += finalized.rejected;
        }
        updateStats(job);
        const downloadFileName = `cv-extraction-${dateStamp()}.xlsx`;
        const excelPath = path.join(job.batchDir, downloadFileName);
        await excelAgent.build(job.rows, excelPath);

        // Auto-push successful candidate rows to Bitrix24 CRM if configured
        if (bitrixAgent && bitrixAgent.isConfigured()) {
          for (const row of job.rows) {
            if (row.status === 'ok' && !row.crmSynced) {
              try {
                const storedFile = Array.isArray(row.storedFiles) && row.storedFiles.length ? row.storedFiles[0] : row.storedFile;
                const filePath = storedFile ? path.join(job.batchDir, 'originals', path.basename(storedFile)) : null;
                const pushRes = await bitrixAgent.pushCandidate({
                  ...row,
                  batchId: job.id
                }, { filePath, stageId: job.stageId || 'DT1156_44:NEW' });
                if (pushRes.success) {
                  row.crmSynced = true;
                  row.crmId = pushRes.crmId;
                  row.crmStageId = pushRes.stageId;
                }
              } catch (crmErr) {
                console.error(`[Job ${job.id}] Bitrix24 auto-push error:`, crmErr.message);
              }
            }
          }
        }

        Object.assign(job, {
          status: 'completed',
          currentFile: '',
          completedAt: new Date().toISOString(),
          downloadFileName,
          excelPath,
          error: ''
        });
        await save(job, true);
        resolveJob(job);
      } catch (error) {
        await failJob(job, error);
      }
    });
  }

  async function failJob(job, error) {
    if (!job || ['completed', 'failed'].includes(job.status)) {
      return;
    }

    job.status = 'failed';
    job.error = errorMessage(error, 'CV processing failed.');
    job.currentFile = '';
    job.completedAt = new Date().toISOString();
    await save(job, true).catch((snapshotError) => console.error('Could not save failed job snapshot:', snapshotError));
    resolveJob(job);
  }

  function resolveJob(job) {
    if (job.resolveCompletion) {
      job.resolveCompletion(job);
      job.resolveCompletion = null;
    }
  }

  function updateStats(job) {
    job.processed = job.processedFiles;
    job.succeeded = job.rows.filter((item) => item.status === 'ok').length;
    job.failed = job.rows.filter((item) => item.status === 'failed').length;
    job.cacheHits = job.rows.filter((item) => item.cacheHit === 'yes').length;
  }

  function publicJob(job) {
    return {
      jobId: job.id,
      stageId: job.stageId,
      status: job.status,
      total: job.total,
      processed: job.processed,
      processedFiles: job.processedFiles,
      succeeded: job.succeeded,
      failed: job.failed,
      cacheHits: job.cacheHits,
      uploaded: job.uploaded,
      skipped: job.skipped,
      duplicates: job.duplicates,
      groupedPages: job.groupedPages,
      rowsVersion: job.rowsVersion,
      activeWorkers: job.activeWorkers,
      peakWorkers: job.peakWorkers,
      currentFile: job.currentFile,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      rows: job.rows,
      error: job.error,
      downloadFileName: job.downloadFileName,
      downloadUrl: job.status === 'completed' ? `/api/jobs/${job.id}/download` : '',
      storageFolder: path.relative(config.projectRoot, job.batchDir)
    };
  }

  async function save(job, force = false) {
    const now = Date.now();
    const activity = job.uploaded + job.skipped + job.duplicates + job.processedFiles;
    const activityDelta = activity - job.lastSnapshotActivity;
    const elapsed = now - job.lastSnapshotAt;
    const shouldWrite =
      force ||
      job.lastSnapshotAt === 0 ||
      activityDelta >= snapshotEveryFiles ||
      elapsed >= snapshotIntervalMs;

    if (!shouldWrite) {
      scheduleSnapshot(job, Math.max(1, snapshotIntervalMs - elapsed));
      return;
    }

    if (job.snapshotTimer) {
      clearTimeout(job.snapshotTimer);
      job.snapshotTimer = null;
    }
    job.lastSnapshotAt = now;
    job.lastSnapshotActivity = activity;

    try {
      await storageAgent.saveSnapshot(job, publicJob(job));
    } catch (error) {
      job.lastSnapshotAt = 0;
      throw error;
    }
  }

  function scheduleSnapshot(job, waitMs) {
    if (job.snapshotTimer || ['completed', 'failed'].includes(job.status)) {
      return;
    }
    job.snapshotTimer = setTimeout(() => {
      job.snapshotTimer = null;
      save(job, true).catch((error) => console.error('Could not save scheduled job snapshot:', error));
    }, waitMs);
    job.snapshotTimer.unref?.();
  }

  async function waitForCompletion(job) {
    await job.completionPromise;
    if (job.status === 'failed') {
      throw new Error(job.error || 'CV processing failed.');
    }
    return job;
  }

  function result(job) {
    return {
      processed: job.processed,
      processedFiles: job.processedFiles,
      groupedPages: job.groupedPages,
      succeeded: job.succeeded,
      failed: job.failed,
      cacheHits: job.cacheHits,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      rows: job.rows,
      downloadFileName: job.downloadFileName,
      excelPath: job.excelPath,
      excelBase64: ''
    };
  }

  function assertAcceptingUploads(job) {
    if (!canAcceptUploads(job)) {
      throw new Error('This job is no longer accepting uploads.');
    }
  }

  return {
    jobs,
    createJob,
    getJob,
    canAcceptUploads,
    addFile,
    addSkippedFile,
    recordDuplicate,
    markUploadComplete,
    ensureRunning,
    publicJob,
    save,
    waitForCompletion,
    result
  };
}
