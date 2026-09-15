import fsp from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { config } from '../src/config.js';
import { safeString, sanitizeFileName, uniqueStrings } from '../src/lib/utils.js';

async function importExcelToHistory() {
  console.log('=== Building Candidate History Batches from Excel Files ===\n');

  const files = [
    path.join(config.projectRoot, 'a7jobs-applications-expired (3).xlsx'),
    path.join(config.projectRoot, 'a7jobs-applications.xlsx'),
    path.join(config.projectRoot, 'A7 group cv data (1).xlsx')
  ];

  const seenCandidates = new Map();
  let totalProcessed = 0;

  for (const filePath of files) {
    try {
      await fsp.access(filePath);
    } catch {
      console.log(`Skipping missing file: ${filePath}`);
      continue;
    }

    const fileName = path.basename(filePath);
    console.log(`Reading "${fileName}"...`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);

    const ws = wb.getWorksheet('Applications') || wb.getWorksheet('CV Data') || wb.worksheets[0];
    if (!ws) continue;

    const headerRow = ws.getRow(1);
    const colMap = {};
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      colMap[colNumber] = String(cell.value || '').trim().toLowerCase();
    });

    let fileCount = 0;
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const getVal = (keys) => {
        for (const [col, h] of Object.entries(colMap)) {
          if (keys.some((k) => h.includes(k.toLowerCase()))) {
            let v = row.getCell(Number(col)).value;
            if (v && typeof v === 'object') v = v.result || v.text || v.hyperlink || '';
            const str = safeString(v).trim();
            if (str) return str;
          }
        }
        return '';
      };

      const name = getVal(['full name', 'name', 'candidate name']);
      if (!name) continue;

      const email = getVal(['email address', 'email']).toLowerCase().trim();
      const rawPhone = getVal(['mobile 1', 'phone number', 'phone', 'mobile']);
      const phoneDigits = rawPhone.replace(/[^0-9]/g, '');
      const secondaryPhone = getVal(['mobile 2', 'secondary phone']);
      const appliedPost = getVal(['applied post', 'job listing', 'listing', 'position applied']);
      const designation = getVal(['current position', 'designation', 'role', 'title']);
      const education = getVal(['highest education', 'education', 'qualification']);
      const fieldOfStudy = getVal(['field of study', 'specialisation', 'major']);
      const fieldOfExperience = getVal(['field of experience', 'domain', 'experience domain']);
      const totalExperienceYears = getVal(['total years experience', 'total experience', 'experience']);
      const dubaiExperienceYears = getVal(['dubai experience (yrs)', 'dubai experience', 'uae experience']);
      const previousEmployers = getVal(['previous employers', 'companies', 'previous company']);
      const nationality = getVal(['nationality']);
      const age = getVal(['age']);
      const gender = getVal(['gender']);
      const address = getVal(['address']);
      const city = getVal(['city']);
      const country = getVal(['country', 'location']);
      const dateOfBirth = getVal(['date of birth', 'dob']);
      const visaStatus = getVal(['visa status', 'visa']);
      const visaExpiryDate = getVal(['visa expiry date', 'visa expiry']);
      const spouseVisa = getVal(['spouse visa (y/n)', 'spouse visa']);
      const visaSponsorName = getVal(['visa sponsor name', 'visa sponsor']);
      const noticePeriod = getVal(['notice period', 'availability']);
      const salaryExpectations = getVal(['salary expectations', 'expected salary']);
      const linkedin = getVal(['linkedin']);
      const instagram = getVal(['instagram']);
      const facebook = getVal(['facebook']);
      const otherSocialLink = getVal(['other social / link', 'social link']);
      const cvUrl = getVal(['cv url', 'cv link', 'download link']);
      const summary = getVal(['summary', 'professional summary']);
      const skills = getVal(['skills', 'core skills']);
      const dateApplied = getVal(['date applied', 'created at', 'date']);

      // Deduplication key
      const key = `${email || ''}|${phoneDigits.slice(-8) || ''}|${name.toLowerCase()}`;

      const candidateObj = {
        name,
        phoneNumber: rawPhone,
        secondaryPhone,
        email,
        gender,
        dateOfBirth,
        age,
        nationality,
        address,
        city,
        country: country || 'United Arab Emirates',
        designation: designation || appliedPost,
        appliedPost: appliedPost || designation,
        fieldOfExperience,
        fieldOfStudy,
        totalExperienceYears,
        dubaiExperienceYears,
        previousEmployers,
        education,
        summary,
        skills,
        linkedin,
        instagram,
        facebook,
        otherSocialLink,
        visaStatus,
        visaExpiryDate,
        spouseVisa,
        visaSponsorName,
        noticePeriod,
        salaryExpectations,
        cvUrl,
        sourceFile: cvUrl ? path.basename(cvUrl.split('?')[0]) : `${name}.pdf`,
        sourceFiles: [cvUrl ? path.basename(cvUrl.split('?')[0]) : `${name}.pdf`],
        storedFile: '',
        storedFiles: [],
        pageCount: 1,
        isResume: true,
        rejectionReason: '',
        isContinuationPage: false,
        continuationConfidence: 0,
        pageNumber: 1,
        confidence: 1,
        missingFields: [],
        inferredFields: [],
        cacheHit: 'yes',
        status: 'ok',
        error: '',
        dateApplied: dateApplied || new Date().toISOString()
      };

      if (!seenCandidates.has(key)) {
        seenCandidates.set(key, candidateObj);
        fileCount++;
        totalProcessed++;
      }
    }

    console.log(`  └─ Added ${fileCount} unique candidates from ${fileName}`);
  }

  const allCandidatesList = Array.from(seenCandidates.values());
  console.log(`\nTotal Unique Candidates to Persist: ${allCandidatesList.length}`);

  // Create Batch Directory
  const batchId = '2026-08-15T12-00-00-excel-applications-archive';
  const batchDir = path.join(config.batchesRoot, batchId);
  const originalsDir = path.join(batchDir, 'originals');

  await fsp.mkdir(batchDir, { recursive: true });
  await fsp.mkdir(originalsDir, { recursive: true });

  const batchResults = {
    jobId: batchId,
    status: 'completed',
    total: allCandidatesList.length,
    processed: allCandidatesList.length,
    processedFiles: allCandidatesList.length,
    succeeded: allCandidatesList.length,
    failed: 0,
    cacheHits: allCandidatesList.length,
    uploaded: allCandidatesList.length,
    skipped: 0,
    duplicates: 0,
    groupedPages: 0,
    rowsVersion: allCandidatesList.length,
    activeWorkers: 0,
    peakWorkers: 1,
    currentFile: '',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    rows: allCandidatesList
  };

  const resultsPath = path.join(batchDir, 'results.json');
  await fsp.writeFile(resultsPath, JSON.stringify(batchResults, null, 2), 'utf8');

  console.log(`\nSuccessfully created batch archive at:`);
  console.log(`${resultsPath}`);
  console.log(`\nCandidate History UI will now show ${allCandidatesList.length} candidate applications!`);
}

importExcelToHistory().catch((err) => {
  console.error('Fatal error building history archive:', err);
  process.exit(1);
});
