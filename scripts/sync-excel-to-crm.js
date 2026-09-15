import path from 'node:path';
import ExcelJS from 'exceljs';

import { createBitrixAgent } from '../src/agents/bitrix-agent.js';
import { config } from '../src/config.js';
import { safeString } from '../src/lib/utils.js';

const bitrixAgent = createBitrixAgent({ config });

async function syncExcelToCrm() {
  const excelFilePath = process.argv[2] || path.join(config.projectRoot, 'A7 group cv data (1).xlsx');

  console.log('=== Sync Excel CV Data to Bitrix24 CRM ===');
  console.log(`Target Excel File: ${excelFilePath}`);

  if (!bitrixAgent.isConfigured()) {
    console.error('Error: BITRIX24_WEBHOOK_URL is not set in .env');
    process.exit(1);
  }

  const conn = await bitrixAgent.testConnection();
  if (!conn.ok) {
    console.error('Error connecting to Bitrix24 CRM:', conn.error);
    process.exit(1);
  }
  console.log(`Connected to Bitrix24 CRM as User: ${conn.user.NAME} ${conn.user.LAST_NAME}`);

  // 1. Read Excel file
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelFilePath);
  const sheet = workbook.worksheets[0];
  console.log(`Loaded sheet "${sheet.name}" with ${sheet.rowCount - 1} candidate rows.`);

  const headers = [];
  sheet.getRow(1).eachCell((cell, colNumber) => {
    headers[colNumber] = safeString(cell.value).trim();
  });

  const excelCandidates = [];
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const rowData = {};
    row.eachCell((cell, colNumber) => {
      const h = headers[colNumber];
      if (h) rowData[h] = safeString(cell.value).trim();
    });

    const name = rowData['Name'] || rowData['name'] || '';
    if (!name) continue;

    excelCandidates.push({
      name,
      phoneNumber: rowData['Phone Number'] || rowData['phone'] || '',
      email: rowData['Email'] || rowData['email'] || '',
      gender: rowData['Gender'] || rowData['gender'] || '',
      dateOfBirth: rowData['Date of Birth'] || rowData['dateOfBirth'] || '',
      address: rowData['Address'] || rowData['address'] || '',
      designation: rowData['Designation'] || rowData['designation'] || '',
      appliedPost: rowData['Applied Post'] || rowData['appliedPost'] || '',
      city: rowData['City'] || rowData['city'] || '',
      summary: rowData['Summary'] || rowData['summary'] || '',
      skills: rowData['Skills'] || rowData['skills'] || '',
      totalExperienceYears: rowData['Total Experience'] || rowData['experience'] || '',
      education: rowData['Education'] || rowData['education'] || ''
    });
  }

  console.log(`Extracted ${excelCandidates.length} valid candidate records from Excel.`);

  // 2. Fetch existing candidates from Bitrix24 CRM to build duplicate set
  console.log('Fetching existing candidate signatures from Bitrix24 CRM...');
  const webhookUrl = config.bitrixWebhookUrl.replace(/\/+$/, '');
  const existingSignatures = new Set();
  let start = 0;

  while (true) {
    const apiUrl = `${webhookUrl}/crm.item.list?entityTypeId=${config.bitrixEntityTypeId}&start=${start}&select[0]=title&select[1]=ufCrm32_1760525672592&select[2]=ufCrm32_1760525678896`;
    try {
      const res = await fetch(apiUrl).then((r) => r.json());
      if (!res.result || !res.result.items || !res.result.items.length) break;

      for (const item of res.result.items) {
        const email = safeString(item.ufCrm32_1760525678896).toLowerCase().trim();
        const phoneDigits = safeString(item.ufCrm32_1760525672592).replace(/[^0-9]/g, '');
        const title = safeString(item.title).toLowerCase().trim();

        if (email) existingSignatures.add(`email:${email}`);
        if (phoneDigits && phoneDigits.length >= 6) existingSignatures.add(`phone:${phoneDigits}`);
        if (title) existingSignatures.add(`title:${title}`);
      }

      if (!res.next) break;
      start = res.next;
    } catch (err) {
      console.warn('Error fetching Bitrix candidates page:', err.message);
      break;
    }
  }

  console.log(`Built index of ${existingSignatures.size} existing CRM candidate signatures.`);

  // 3. Process candidates from Excel and push non-duplicates
  let addedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < excelCandidates.length; i += 1) {
    const candidate = excelCandidates[i];
    const emailKey = candidate.email ? `email:${candidate.email.toLowerCase().trim()}` : null;
    const phoneDigits = candidate.phoneNumber.replace(/[^0-9]/g, '');
    const phoneKey = phoneDigits.length >= 6 ? `phone:${phoneDigits}` : null;
    const appliedRole = candidate.appliedPost || candidate.designation || '';
    const title = appliedRole ? `${candidate.name} - ${appliedRole}` : candidate.name;
    const titleKey = `title:${title.toLowerCase().trim()}`;

    const isDuplicate =
      (emailKey && existingSignatures.has(emailKey)) ||
      (phoneKey && existingSignatures.has(phoneKey)) ||
      existingSignatures.has(titleKey);

    if (isDuplicate) {
      skippedCount += 1;
      console.log(`[${i + 1}/${excelCandidates.length}] Skipped (Already in CRM): ${candidate.name} (${appliedRole})`);
      continue;
    }

    console.log(`[${i + 1}/${excelCandidates.length}] Adding to CRM: ${candidate.name} (${appliedRole}) ...`);
    const result = await bitrixAgent.pushCandidate(candidate);

    if (result.success) {
      addedCount += 1;
      if (emailKey) existingSignatures.add(emailKey);
      if (phoneKey) existingSignatures.add(phoneKey);
      existingSignatures.add(titleKey);
      console.log(`  └─ Success! Created Bitrix item ID #${result.crmId}`);
    } else {
      failedCount += 1;
      console.error(`  └─ Failed: ${result.error}`);
    }

    await new Promise((r) => setTimeout(r, 350));
  }

  console.log('\n=== Excel Sync Completed ===');
  console.log(`Total Excel Candidates: ${excelCandidates.length}`);
  console.log(`Added to CRM: ${addedCount}`);
  console.log(`Already in CRM (Skipped): ${skippedCount}`);
  console.log(`Failed: ${failedCount}`);
}

syncExcelToCrm().catch((err) => {
  console.error('Fatal error during Excel CRM sync:', err);
  process.exit(1);
});
