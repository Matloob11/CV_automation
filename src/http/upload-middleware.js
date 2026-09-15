import fs from 'node:fs';
import path from 'node:path';

import multer from 'multer';

import { sanitizeFileName } from '../lib/utils.js';

export function createUploadMiddleware({ config, storageAgent, jobProcessor }) {
  const upload = multer({
    storage: multer.diskStorage({
      destination(req, _file, callback) {
        if (!req.batchOriginalsDir) {
          return callback(new Error('Upload batch was not initialised.'));
        }
        fs.mkdirSync(req.batchOriginalsDir, { recursive: true });
        callback(null, req.batchOriginalsDir);
      },
      filename(req, file, callback) {
        if (req.job) {
          req.job.uploadSequence = (req.job.uploadSequence || 0) + 1;
          req.uploadFileIndex = req.job.uploadSequence;
        } else {
          req.uploadFileIndex = (req.uploadFileIndex || 0) + 1;
        }
        const prefix = String(req.uploadFileIndex).padStart(5, '0');
        callback(null, `${prefix}-${sanitizeFileName(file.originalname)}`);
      }
    }),
    limits: {
      files: config.maxFiles,
      fileSize: config.maxFileSizeBytes
    }
  });

  function createBatchContext(req, _res, next) {
    Object.assign(req, storageAgent.createBatch());
    req.batchOriginalsDir = req.originalsDir;
    next();
  }

  function attachExistingBatch(req, res, next) {
    const job = jobProcessor.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    if (!jobProcessor.canAcceptUploads(job)) {
      return res.status(409).json({ error: 'This job is no longer accepting uploads.' });
    }

    req.job = job;
    req.batchId = job.id;
    req.batchDir = job.batchDir;
    req.batchOriginalsDir = path.join(job.batchDir, 'originals');
    fs.mkdirSync(req.batchOriginalsDir, { recursive: true });
    next();
  }

  function handleSingleCvUpload(req, res, next) {
    upload.single('cv')(req, res, (error) => {
      if (!error) {
        return next();
      }
      if (error instanceof multer.MulterError) {
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({ error: multerErrorMessage(error, config) });
      }
      console.error(error);
      return res.status(500).json({ error: error.message || 'Could not upload CV file.' });
    });
  }

  return {
    uploadArray: upload.array('cvs', config.maxFiles),
    createBatchContext,
    attachExistingBatch,
    handleSingleCvUpload,
    multer,
    multerErrorMessage: (error) => multerErrorMessage(error, config)
  };
}

function multerErrorMessage(error, config) {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return `This CV is over the ${config.maxFileSizeMb} MB per-file limit. It can be skipped and the rest of the folder can continue.`;
  }
  if (error.code === 'LIMIT_FILE_COUNT') {
    return `Too many CVs selected. Maximum supported files per batch is ${config.maxFiles}.`;
  }
  return error.message || 'Upload failed.';
}
