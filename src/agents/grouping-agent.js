import path from 'node:path';

import { candidateFields } from '../schema.js';
import {
  clampConfidence,
  combinePageText,
  firstValue,
  isImageFile,
  normalizeComparableText,
  safeString,
  uniqueStrings
} from '../lib/utils.js';

export function createGroupingAgent({ maxPages }) {
  function createState() {
    return { previousCandidateIndex: -1 };
  }

  function addProcessedRow(rows, row, file, state) {
    if (Array.isArray(row)) {
      for (const singleRow of row) {
        rows.push(singleRow);
      }
      state.previousCandidateIndex = -1;
      return false;
    }

    const previous = getPreviousImageCandidate(rows, state, file);
    if (previous && row.status === 'ok' && shouldMerge(previous, row, file)) {
      rows[state.previousCandidateIndex] = mergeCandidatePages(previous, row);
      return true;
    }

    rows.push(row);
    state.previousCandidateIndex = isImageFile(file) && row.status === 'ok' ? rows.length - 1 : -1;
    return false;
  }

  function getPreviousImageCandidate(rows, state, file) {
    if (!isImageFile(file)) {
      return null;
    }

    const row = rows[state.previousCandidateIndex];
    if (!row || row.status !== 'ok' || Number(row.pageCount || 1) >= maxPages) {
      return null;
    }
    return row;
  }

  function shouldMerge(previous, current, file) {
    if (Number(previous.pageCount || 1) >= maxPages || hasConflictingCandidateIdentity(previous, current)) {
      return false;
    }

    if (sharesCandidateIdentity(previous, current) || sharesImageGroupName(previous, file.originalname)) {
      return true;
    }

    return current.isContinuationPage === true && current.continuationConfidence >= 0.72;
  }

  return { createState, addProcessedRow, shouldMerge, mergeCandidatePages };
}

function mergeCandidatePages(previous, current) {
  const merged = {
    ...previous,
    sourceFiles: uniqueStrings([...(previous.sourceFiles || [previous.sourceFile]), current.sourceFile]),
    storedFiles: uniqueStrings([...(previous.storedFiles || [previous.storedFile]), current.storedFile]),
    pageCount: Number(previous.pageCount || 1) + Number(current.pageCount || 1),
    name: firstValue(previous.name, current.name),
    phoneNumber: combinePageText(previous.phoneNumber, current.phoneNumber, ' | '),
    secondaryPhone: combinePageText(previous.secondaryPhone, current.secondaryPhone, ' | '),
    email: combinePageText(previous.email, current.email, ' | '),
    gender: firstValue(previous.gender, current.gender),
    dateOfBirth: firstValue(previous.dateOfBirth, current.dateOfBirth),
    age: firstValue(previous.age, current.age),
    nationality: firstValue(previous.nationality, current.nationality),
    address: combinePageText(previous.address, current.address),
    city: firstValue(previous.city, current.city),
    country: firstValue(previous.country, current.country),
    designation: firstValue(previous.designation, current.designation),
    appliedPost: firstValue(previous.appliedPost, current.appliedPost),
    fieldOfExperience: firstValue(previous.fieldOfExperience, current.fieldOfExperience),
    fieldOfStudy: firstValue(previous.fieldOfStudy, current.fieldOfStudy),
    totalExperienceYears: firstValue(previous.totalExperienceYears, current.totalExperienceYears),
    dubaiExperienceYears: firstValue(previous.dubaiExperienceYears, current.dubaiExperienceYears),
    previousEmployers: combinePageText(previous.previousEmployers, current.previousEmployers, ' | '),
    education: combinePageText(previous.education, current.education),
    summary: combinePageText(previous.summary, current.summary, ' '),
    skills: combinePageText(previous.skills, current.skills),
    linkedin: firstValue(previous.linkedin, current.linkedin),
    instagram: firstValue(previous.instagram, current.instagram),
    facebook: firstValue(previous.facebook, current.facebook),
    otherSocialLink: firstValue(previous.otherSocialLink, current.otherSocialLink),
    visaStatus: firstValue(previous.visaStatus, current.visaStatus),
    visaExpiryDate: firstValue(previous.visaExpiryDate, current.visaExpiryDate),
    spouseVisa: firstValue(previous.spouseVisa, current.spouseVisa),
    visaSponsorName: firstValue(previous.visaSponsorName, current.visaSponsorName),
    noticePeriod: firstValue(previous.noticePeriod, current.noticePeriod),
    salaryExpectations: firstValue(previous.salaryExpectations, current.salaryExpectations),
    isResume: true,
    rejectionReason: '',
    isContinuationPage: false,
    continuationConfidence: 0,
    pageNumber: 1,
    confidence: Math.max(clampConfidence(previous.confidence), clampConfidence(current.confidence)),
    inferredFields: uniqueStrings([...(previous.inferredFields || []), ...(current.inferredFields || [])]),
    cacheHit: previous.cacheHit === 'yes' && current.cacheHit === 'yes' ? 'yes' : 'no',
    status: 'ok',
    error: ''
  };

  merged.sourceFile = merged.sourceFiles.join(' | ');
  merged.storedFile = merged.storedFiles.join(' | ');
  merged.missingFields = candidateFields.filter((key) => !safeString(merged[key])).join(', ');
  return merged;
}

function sharesCandidateIdentity(previous, current) {
  if (hasTokenOverlap(emailTokens(previous.email), emailTokens(current.email))) {
    return true;
  }
  if (hasTokenOverlap(phoneTokens(previous.phoneNumber), phoneTokens(current.phoneNumber))) {
    return true;
  }

  const previousName = normalizeComparableText(previous.name);
  const currentName = normalizeComparableText(current.name);
  return Boolean(previousName && previousName.length >= 4 && previousName === currentName);
}

function hasConflictingCandidateIdentity(previous, current) {
  if (sharesCandidateIdentity(previous, current)) {
    return false;
  }

  const previousEmails = emailTokens(previous.email);
  const currentEmails = emailTokens(current.email);
  if (previousEmails.length && currentEmails.length) {
    return true;
  }

  const previousPhones = phoneTokens(previous.phoneNumber);
  const currentPhones = phoneTokens(current.phoneNumber);
  if (previousPhones.length && currentPhones.length) {
    return true;
  }

  const previousName = normalizeComparableText(previous.name);
  const currentName = normalizeComparableText(current.name);
  return Boolean(previousName && currentName && previousName !== currentName);
}

function sharesImageGroupName(previous, currentFileName) {
  const currentKey = imageGroupKey(currentFileName);
  if (!currentKey) {
    return false;
  }

  const previousFiles = previous.sourceFiles || [previous.sourceFile];
  const previousKey = imageGroupKey(previousFiles.at(-1));
  return Boolean(previousKey && previousKey === currentKey);
}

function imageGroupKey(fileName) {
  const name = path.parse(path.basename(safeString(fileName).replaceAll('\\', '/'))).name.trim();
  if (!name) {
    return '';
  }

  const explicitPageStem = name.replace(/(?:[\s._-]+(?:page|pg|p)[\s._-]*0?\d+|\s*\(\d+\))$/i, '');
  if (explicitPageStem !== name && isMeaningfulImageGroupStem(explicitPageStem)) {
    return normalizeComparableText(explicitPageStem);
  }

  const numericSuffix = name.match(/^(.*?)[\s_-]+0?(\d+)$/);
  if (numericSuffix && isMeaningfulImageGroupStem(numericSuffix[1])) {
    return normalizeComparableText(numericSuffix[1]);
  }

  return '';
}

function isMeaningfulImageGroupStem(value) {
  const stem = normalizeComparableText(value);
  if (stem.length < 3 || !/[a-z]/.test(stem)) {
    return false;
  }
  return !/^(img|image|scan|photo|whatsappimage|screenshot|cv|resume)\d*$/.test(stem);
}

function emailTokens(value) {
  return uniqueStrings(safeString(value).toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []);
}

function phoneTokens(value) {
  return uniqueStrings(
    safeString(value)
      .split(/[|;,/]/)
      .map((item) => item.replace(/\D/g, ''))
      .filter((item) => item.length >= 7)
      .map((item) => item.slice(-10))
  );
}

function hasTokenOverlap(left, right) {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}
