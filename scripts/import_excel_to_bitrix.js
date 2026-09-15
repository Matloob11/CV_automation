import ExcelJS from 'exceljs';
import dotenv from 'dotenv';
import { createBitrixAgent } from '../src/agents/bitrix-agent.js';

dotenv.config();

const bitrixAgent = createBitrixAgent({});

if (!bitrixAgent.isConfigured()) {
  console.error('Error: BITRIX24_WEBHOOK_URL is not configured in .env');
  process.exit(1);
}

async function importExcelToBitrix(excelPath) {
  console.log(`\n========================================`);
  console.log(`Starting high-performance import: ${excelPath}`);
  console.log(`========================================\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(excelPath);

  const ws = wb.getWorksheet('Applications') || wb.getWorksheet('CV Data') || wb.worksheets[0];
  if (!ws) {
    console.error('No worksheet found in Excel file.');
    return;
  }

  const rowCount = ws.rowCount;
  console.log(`Total rows in worksheet "${ws.name}": ${rowCount}`);

  const headerRow = ws.getRow(1);
  const colMap = {};
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const val = String(cell.value || '').trim().toLowerCase();
    colMap[colNumber] = val;
  });

  const candidates = [];

  for (let r = 2; r <= rowCount; r++) {
    const row = ws.getRow(r);

    const getVal = (possibleHeaders) => {
      for (const [colNum, headerName] of Object.entries(colMap)) {
        if (possibleHeaders.some(ph => headerName.includes(ph.toLowerCase()))) {
          let cellVal = row.getCell(Number(colNum)).value;
          if (cellVal && typeof cellVal === 'object') {
            cellVal = cellVal.result || cellVal.text || cellVal.hyperlink || '';
          }
          const str = String(cellVal || '').trim();
          if (str) return str;
        }
      }
      return '';
    };

    const name = getVal(['full name', 'name', 'title']);
    if (!name) continue;

    candidates.push({
      rowNum: r,
      name,
      jobListing: getVal(['job listing', 'listing']),
      appliedPost: getVal(['applied post', 'job listing', 'current position', 'position', 'post']),
      designation: getVal(['current position', 'designation', 'role']),
      phoneNumber: getVal(['mobile 1', 'phone number', 'phone', 'mobile']),
      secondaryPhone: getVal(['mobile 2', 'secondary phone']),
      email: getVal(['email address', 'email']),
      gender: getVal(['gender']),
      dateOfBirth: getVal(['date of birth', 'dob']),
      age: getVal(['age']),
      nationality: getVal(['nationality']),
      education: getVal(['highest education', 'education', 'qualification']),
      fieldOfStudy: getVal(['field of study', 'specialisation', 'major']),
      fieldOfExperience: getVal(['field of experience', 'domain']),
      totalExperienceYears: getVal(['total years experience', 'total experience', 'experience']),
      dubaiExperienceYears: getVal(['dubai experience']),
      previousEmployers: getVal(['previous employers', 'companies']),
      visaStatus: getVal(['visa status', 'visa']),
      visaExpiryDate: getVal(['visa expiry']),
      spouseVisa: getVal(['spouse visa']),
      visaSponsorName: getVal(['visa sponsor']),
      cvUrl: getVal(['cv url', 'cv link', 'download link']),
      currentStage: getVal(['current stage', 'stage']),
      noticePeriod: getVal(['notice period', 'availability']),
      salaryExpectations: getVal(['salary expectations', 'expected salary']),
      country: getVal(['country', 'location']),
      city: getVal(['city']),
      address: getVal(['address']),
      summary: getVal(['summary']),
      skills: getVal(['skills'])
    });
  }

  console.log(`Loaded ${candidates.length} candidate records from ${excelPath}.`);

  // Fetch existing CRM signatures to prevent creating duplicate cards
  console.log('Checking existing candidate signatures from Bitrix24 CRM...');
  const webhookUrl = (process.env.BITRIX24_WEBHOOK_URL || '').replace(/\/+$/, '');
  const existingSignatures = new Set();
  let start = 0;

  while (webhookUrl) {
    const apiUrl = `${webhookUrl}/crm.item.list?entityTypeId=1156&start=${start}&select[0]=title&select[1]=ufCrm32_1760525672592&select[2]=ufCrm32_1760525678896`;
    try {
      const res = await fetch(apiUrl).then((r) => r.json());
      if (!res.result || !res.result.items || !res.result.items.length) break;

      for (const item of res.result.items) {
        const email = String(item.ufCrm32_1760525678896 || '').toLowerCase().trim();
        const phoneDigits = String(item.ufCrm32_1760525672592 || '').replace(/[^0-9]/g, '');
        const title = String(item.title || '').toLowerCase().trim();

        if (email) existingSignatures.add(`email:${email}`);
        if (phoneDigits && phoneDigits.length >= 6) existingSignatures.add(`phone:${phoneDigits.slice(-8)}`);
        if (title) existingSignatures.add(`title:${title}`);
      }

      if (!res.next) break;
      start = res.next;
    } catch (err) {
      console.warn('Note: Could not complete Bitrix signature list, proceeding:', err.message);
      break;
    }
  }

  console.log(`Indexed ${existingSignatures.size} existing CRM candidate records.`);

  let pushed = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const emailKey = cand.email ? `email:${cand.email.toLowerCase().trim()}` : null;
    const phoneDigits = cand.phoneNumber ? cand.phoneNumber.replace(/[^0-9]/g, '') : '';
    const phoneKey = phoneDigits.length >= 6 ? `phone:${phoneDigits.slice(-8)}` : null;
    const appliedRole = cand.appliedPost || cand.designation || '';
    const title = appliedRole ? `${cand.name} - ${appliedRole}` : cand.name;
    const titleKey = `title:${title.toLowerCase().trim()}`;

    const isDuplicate =
      (emailKey && existingSignatures.has(emailKey)) ||
      (phoneKey && existingSignatures.has(phoneKey)) ||
      existingSignatures.has(titleKey);

    if (isDuplicate) {
      skipped++;
      continue;
    }

    const res = await bitrixAgent.pushCandidate(cand);
    if (res.success) {
      pushed++;
      if (emailKey) existingSignatures.add(emailKey);
      if (phoneKey) existingSignatures.add(phoneKey);
      existingSignatures.add(titleKey);
      if (pushed % 25 === 0 || pushed === 1) {
        console.log(`[${pushed} pushed / ${skipped} skipped] Pushed "${cand.name}" -> Bitrix ID #${res.crmId}`);
      }
    } else {
      failed++;
      console.warn(`[Row ${cand.rowNum}] Failed to push "${cand.name}": ${res.error}`);
    }

    // Gentle throttle to avoid rate-limiting
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`\n========================================`);
  console.log(`Finished ${excelPath}`);
  console.log(`Total: ${candidates.length} | Pushed: ${pushed} | Skipped: ${skipped} | Failed: ${failed}`);
  console.log(`========================================\n`);
}

async function run() {
  const targetFile = process.argv[2];
  if (targetFile) {
    await importExcelToBitrix(targetFile);
  } else {
    await importExcelToBitrix('a7jobs-applications-expired (3).xlsx');
    await importExcelToBitrix('a7jobs-applications.xlsx');
    await importExcelToBitrix('A7 group cv data (1).xlsx');
  }
}

run().catch(console.error);

