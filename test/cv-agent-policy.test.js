import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExtractionPrompt, enrichProfessionalFields } from '../src/agents/cv-agent.js';
import {
  hasUsableCandidateDetails,
  isFilenamePlaceholder,
  rejectUnusableCandidateRows
} from '../src/agents/candidate-policy.js';

test('extraction prompt forbids demographic guessing and tracks professional inference', () => {
  const prompt = buildExtractionPrompt({
    fileName: 'candidate-page-2.jpg',
    defaultAppliedPost: 'Sales Executive',
    resumeText: '',
    isImage: true
  });

  assert.match(prompt, /Never infer gender from a name/i);
  assert.match(prompt, /date of birth must be explicitly present/i);
  assert.match(prompt, /inferredFields/);
  assert.match(prompt, /classification must be independent/i);
});

test('professional fallback derives applied post without guessing personal data', () => {
  const row = enrichProfessionalFields({
    name: 'Jordan Lee',
    designation: 'Sales Executive',
    appliedPost: '',
    gender: '',
    dateOfBirth: '',
    inferredFields: [],
    missingFields: []
  });

  assert.equal(row.appliedPost, 'Sales Executive');
  assert.ok(row.inferredFields.includes('appliedPost'));
  assert.equal(row.gender, '');
  assert.equal(row.dateOfBirth, '');
});

test('candidate policy rejects filename-only rows and keeps supported candidate records', () => {
  assert.equal(
    hasUsableCandidateDetails(
      { name: 'IMG-20260614-WA0009.jpg', summary: 'Unreadable profile' },
      'IMG-20260614-WA0009.jpg'
    ),
    false
  );
  assert.equal(isFilenamePlaceholder('Ali Khan', 'Ali Khan.pdf'), false);
  assert.equal(
    hasUsableCandidateDetails({ name: 'Ali Khan', phoneNumber: '03001234567' }, 'Ali Khan.pdf'),
    true
  );
  assert.equal(
    hasUsableCandidateDetails({
      education: 'MBA',
      isContinuationPage: true,
      continuationConfidence: 0.9
    }),
    true
  );

  const finalized = rejectUnusableCandidateRows([
    { status: 'ok', sourceFile: 'blank.jpg', name: '', summary: 'Generated summary' },
    { status: 'ok', sourceFile: 'ali.pdf', name: 'Ali Khan', phoneNumber: '03001234567' }
  ]);
  assert.equal(finalized.rejected, 1);
  assert.equal(finalized.rows[0].status, 'failed');
  assert.equal(finalized.rows[1].status, 'ok');
});
