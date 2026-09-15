import path from 'node:path';

import { normalizeComparableText, safeString } from '../lib/utils.js';

const supportingFields = [
  'dateOfBirth',
  'address',
  'designation',
  'city',
  'country',
  'skills',
  'totalExperienceYears',
  'education',
  'nationality',
  'visaStatus',
  'noticePeriod',
  'salaryExpectations',
  'fieldOfExperience',
  'previousEmployers'
];
const unusableCandidateReason = 'No clear candidate details were found in this file.';

export function hasUsableCandidateDetails(row = {}, sourceFile = row.sourceFile) {
  const usableName = safeString(row.name) && !isFilenamePlaceholder(row.name, sourceFile);
  const hasPhone = Boolean(safeString(row.phoneNumber));
  const hasEmail = Boolean(safeString(row.email));
  const supportingCount = supportingFields.filter((field) => safeString(row[field])).length;

  if (usableName && (hasPhone || hasEmail || supportingCount > 0)) return true;
  if (hasPhone && hasEmail) return true;
  if ((hasPhone || hasEmail) && supportingCount > 0) return true;

  return Boolean(
    row.isContinuationPage === true &&
      Number(row.continuationConfidence || 0) >= 0.72 &&
      supportingCount > 0
  );
}

export function isFilenamePlaceholder(name, sourceFile) {
  const candidateName = safeString(name);
  const sourceName = firstSourceName(sourceFile);
  if (!candidateName || !sourceName) return false;

  const candidateBase = path.basename(candidateName.replaceAll('\\', '/'));
  const sourceBase = path.basename(sourceName.replaceAll('\\', '/'));
  const candidateWithoutExtension = path.parse(candidateBase).name;
  const sourceWithoutExtension = path.parse(sourceBase).name;
  const matchesSource =
    normalizeComparableText(candidateWithoutExtension) === normalizeComparableText(sourceWithoutExtension);

  if (!matchesSource) return false;
  if (/\.(?:pdf|docx?|txt|rtf|md|png|jpe?g|webp)$/i.test(candidateBase)) return true;

  const sourceWords = sourceWithoutExtension.toLowerCase();
  const genericPrefix = /^(?:img|image|scan|scanned|screenshot|whatsapp|docscanner|document|untitled|photo|picture|page|resume|cv|file)(?:\W|\d|$)/i;
  const genericWords = /\b(?:resume|curriculum|vitae|document|template|scan|image|photo|screenshot)\b/i;
  return genericPrefix.test(sourceWords) || genericWords.test(sourceWords);
}

export function rejectUnusableCandidateRows(rows = []) {
  let rejected = 0;
  const finalizedRows = rows.map((row) => {
    if (row.status !== 'ok' || hasUsableCandidateDetails(row, row.sourceFile)) return row;
    rejected += 1;
    return {
      ...row,
      isResume: false,
      rejectionReason: unusableCandidateReason,
      status: 'failed',
      error: unusableCandidateReason,
      summary: unusableCandidateReason
    };
  });
  return { rows: finalizedRows, rejected };
}

function firstSourceName(sourceFile) {
  return safeString(sourceFile).split('|')[0].trim();
}
