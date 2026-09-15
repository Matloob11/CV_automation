import { clampConfidence, safeString, uniqueStrings } from './lib/utils.js';

export const candidateFields = [
  'name',
  'phoneNumber',
  'email',
  'gender',
  'dateOfBirth',
  'age',
  'nationality',
  'address',
  'city',
  'country',
  'designation',
  'appliedPost',
  'fieldOfExperience',
  'fieldOfStudy',
  'totalExperienceYears',
  'dubaiExperienceYears',
  'previousEmployers',
  'education',
  'summary',
  'skills',
  'secondaryPhone',
  'linkedin',
  'instagram',
  'facebook',
  'otherSocialLink',
  'visaStatus',
  'visaExpiryDate',
  'spouseVisa',
  'visaSponsorName',
  'noticePeriod',
  'salaryExpectations'
];

export const resumeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    phoneNumber: { type: 'string' },
    email: { type: 'string' },
    gender: { type: 'string' },
    dateOfBirth: { type: 'string' },
    age: { type: 'string' },
    nationality: { type: 'string' },
    address: { type: 'string' },
    city: { type: 'string' },
    country: { type: 'string' },
    designation: { type: 'string' },
    appliedPost: { type: 'string' },
    fieldOfExperience: { type: 'string' },
    fieldOfStudy: { type: 'string' },
    totalExperienceYears: { type: 'string' },
    dubaiExperienceYears: { type: 'string' },
    previousEmployers: { type: 'string' },
    education: { type: 'string' },
    summary: { type: 'string' },
    skills: { type: 'string' },
    secondaryPhone: { type: 'string' },
    linkedin: { type: 'string' },
    instagram: { type: 'string' },
    facebook: { type: 'string' },
    otherSocialLink: { type: 'string' },
    visaStatus: { type: 'string' },
    visaExpiryDate: { type: 'string' },
    spouseVisa: { type: 'string' },
    visaSponsorName: { type: 'string' },
    noticePeriod: { type: 'string' },
    salaryExpectations: { type: 'string' },
    isResume: { type: 'boolean' },
    rejectionReason: { type: 'string' },
    isContinuationPage: { type: 'boolean' },
    continuationConfidence: { type: 'number' },
    pageNumber: { type: 'number' },
    confidence: { type: 'number' },
    missingFields: {
      type: 'array',
      items: { type: 'string' }
    },
    inferredFields: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: [
    ...candidateFields,
    'isResume',
    'rejectionReason',
    'isContinuationPage',
    'continuationConfidence',
    'pageNumber',
    'confidence',
    'missingFields',
    'inferredFields'
  ]
};

export const excelColumns = [
  ['name', 'Full Name'],
  ['phoneNumber', 'Mobile 1'],
  ['secondaryPhone', 'Mobile 2'],
  ['email', 'Email Address'],
  ['gender', 'Gender'],
  ['dateOfBirth', 'Date of Birth'],
  ['age', 'Age'],
  ['nationality', 'Nationality'],
  ['address', 'Address'],
  ['city', 'City'],
  ['country', 'Country'],
  ['designation', 'Current Position'],
  ['appliedPost', 'Job Listing / Applied Post'],
  ['fieldOfExperience', 'Field of Experience'],
  ['fieldOfStudy', 'Field of Study / Specialisation'],
  ['totalExperienceYears', 'Total Years Experience'],
  ['dubaiExperienceYears', 'Dubai Experience (Yrs)'],
  ['previousEmployers', 'Previous Employers'],
  ['education', 'Highest Education'],
  ['summary', 'Summary'],
  ['skills', 'Skills'],
  ['linkedin', 'LinkedIn'],
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
  ['otherSocialLink', 'Other Social / Link'],
  ['visaStatus', 'Visa Status'],
  ['visaExpiryDate', 'Visa Expiry Date'],
  ['spouseVisa', 'Spouse Visa (Y/N)'],
  ['visaSponsorName', 'Visa Sponsor Name'],
  ['noticePeriod', 'Notice Period / Availability'],
  ['salaryExpectations', 'Salary Expectations']
];

export function cleanExtraction(row = {}) {
  const cleaned = Object.fromEntries(candidateFields.map((key) => [key, safeString(row[key])]));
  const pageNumber = Number(row.pageNumber);
  const inferredFields = uniqueStrings(Array.isArray(row.inferredFields) ? row.inferredFields : []).filter(
    (key) => candidateFields.includes(key) && cleaned[key]
  );
  if (cleaned.summary && !inferredFields.includes('summary')) {
    inferredFields.push('summary');
  }

  return {
    ...cleaned,
    isResume: row.isResume === true,
    rejectionReason: safeString(row.rejectionReason),
    isContinuationPage: row.isContinuationPage === true,
    continuationConfidence: row.isContinuationPage === true ? clampConfidence(row.continuationConfidence) : 0,
    pageNumber: Number.isFinite(pageNumber) ? Math.max(0, Math.round(pageNumber)) : 0,
    confidence: clampConfidence(row.confidence),
    missingFields: candidateFields.filter((key) => !cleaned[key]),
    inferredFields
  };
}
