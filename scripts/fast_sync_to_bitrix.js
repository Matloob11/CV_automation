import ExcelJS from 'exceljs';
import dotenv from 'dotenv';
import path from 'node:path';
import { safeString } from '../src/lib/utils.js';

dotenv.config();

const webhookUrl = (process.env.BITRIX24_WEBHOOK_URL || '').replace(/\/+$/, '');
if (!webhookUrl) {
  console.error('Error: BITRIX24_WEBHOOK_URL is not set in .env.');
  process.exit(1);
}
const entityTypeId = 1156;
const defaultStageId = 'DT1156_44:NEW';

function splitName(fullName = '') {
  const clean = safeString(fullName).trim();
  if (!clean) return { firstName: '', lastName: '' };
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function buildCandidatePayload(cand) {
  const { firstName, lastName } = splitName(cand.name);
  const appliedRole = safeString(cand.appliedPost || cand.designation);
  const title = appliedRole ? `${cand.name} - ${appliedRole}` : cand.name;

  // Clean CV Card Profile Description
  const cvLines = [];
  cvLines.push('📄 CANDIDATE CV PROFILE');
  cvLines.push('──────────────────────────────');
  if (cand.name) cvLines.push(`• Full Name: ${cand.name}`);
  if (appliedRole) cvLines.push(`• Position / Role: ${appliedRole}`);
  if (cand.phoneNumber) cvLines.push(`• Mobile: ${cand.phoneNumber}`);
  if (cand.secondaryPhone) cvLines.push(`• Secondary Mobile: ${cand.secondaryPhone}`);
  if (cand.email) cvLines.push(`• Email: ${cand.email}`);

  const personalInfo = [
    cand.nationality ? `Nationality: ${cand.nationality}` : '',
    cand.age ? `Age: ${cand.age}` : '',
    cand.gender ? `Gender: ${cand.gender}` : ''
  ].filter(Boolean).join(' | ');
  if (personalInfo) cvLines.push(`• Personal: ${personalInfo}`);

  const loc = [cand.city, cand.country, cand.address].filter(Boolean).join(', ');
  if (loc) cvLines.push(`• Location: ${loc}`);

  const expDetails = [
    cand.totalExperienceYears ? `Total: ${cand.totalExperienceYears}` : '',
    cand.dubaiExperienceYears ? `UAE / Dubai: ${cand.dubaiExperienceYears}` : '',
    cand.fieldOfExperience ? `Field: ${cand.fieldOfExperience}` : ''
  ].filter(Boolean).join(' | ');
  if (expDetails) cvLines.push(`• Experience: ${expDetails}`);

  if (cand.previousEmployers) cvLines.push(`• Previous Employers: ${cand.previousEmployers}`);

  const eduDetails = [
    cand.education ? cand.education : '',
    cand.fieldOfStudy ? `(${cand.fieldOfStudy})` : ''
  ].filter(Boolean).join(' ');
  if (eduDetails) cvLines.push(`• Education: ${eduDetails}`);

  const visaDetails = [
    cand.visaStatus ? `Status: ${cand.visaStatus}` : '',
    cand.visaExpiryDate ? `Expires: ${cand.visaExpiryDate}` : '',
    cand.spouseVisa ? `Spouse Visa: ${cand.spouseVisa}` : '',
    cand.visaSponsorName ? `Sponsor: ${cand.visaSponsorName}` : ''
  ].filter(Boolean).join(' | ');
  if (visaDetails) cvLines.push(`• Visa: ${visaDetails}`);

  if (cand.noticePeriod) cvLines.push(`• Notice Period: ${cand.noticePeriod}`);
  if (cand.salaryExpectations) cvLines.push(`• Salary Expectations: ${cand.salaryExpectations}`);
  if (cand.skills) cvLines.push(`• Skills: ${cand.skills}`);
  if (cand.summary) cvLines.push(`• Summary: ${cand.summary}`);

  const socialLinks = [
    cand.linkedin ? `LinkedIn: ${cand.linkedin}` : '',
    cand.instagram ? `Instagram: ${cand.instagram}` : '',
    cand.facebook ? `Facebook: ${cand.facebook}` : '',
    cand.otherSocialLink ? `Other: ${cand.otherSocialLink}` : ''
  ].filter(Boolean).join(' | ');
  if (socialLinks) cvLines.push(`• Social: ${socialLinks}`);

  if (cand.cvUrl) cvLines.push(`\n🔗 CV PDF Link:\n${cand.cvUrl}`);

  let expText = '';
  if (cand.totalExperienceYears || cand.dubaiExperienceYears) {
    expText = [
      cand.totalExperienceYears ? `${cand.totalExperienceYears} total` : '',
      cand.dubaiExperienceYears ? `${cand.dubaiExperienceYears} UAE` : ''
    ].filter(Boolean).join(' | ');
  } else if (cand.fieldOfExperience) {
    expText = safeString(cand.fieldOfExperience);
  }

  return {
    stageId: defaultStageId,
    title: title.slice(0, 255),
    ufCrm32_1760525662256: firstName.slice(0, 100),
    ufCrm32_1760525666320: lastName.slice(0, 100),
    ufCrm32_1760525724346: expText.slice(0, 50),
    ufCrm32_1760525672592: safeString(cand.phoneNumber).slice(0, 50),
    ufCrm32_1760525678896: safeString(cand.email).slice(0, 100),
    ufCrm32_1760525687473: appliedRole.slice(0, 100),
    ufCrm32_1760525758: cvLines.join('\n')
  };
}

async function fastSync() {
  console.log('=== Fast Bitrix24 CRM Batch Sync ===\n');

  const files = [
    'a7jobs-applications-expired (3).xlsx',
    'a7jobs-applications.xlsx',
    'A7 group cv data (1).xlsx'
  ];

  const candidateMap = new Map();

  for (const f of files) {
    const filePath = path.resolve(f);
    console.log(`Reading "${f}"...`);
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.readFile(filePath);
    } catch {
      continue;
    }

    const ws = wb.getWorksheet('Applications') || wb.getWorksheet('CV Data') || wb.worksheets[0];
    if (!ws) continue;

    const colMap = {};
    ws.getRow(1).eachCell((c, col) => {
      colMap[col] = String(c.value || '').trim().toLowerCase();
    });

    let added = 0;
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const getVal = (keys) => {
        for (const [col, h] of Object.entries(colMap)) {
          if (keys.some((k) => h.includes(k.toLowerCase()))) {
            let v = row.getCell(Number(col)).value;
            if (v && typeof v === 'object') v = v.result || v.text || v.hyperlink || '';
            const s = safeString(v).trim();
            if (s) return s;
          }
        }
        return '';
      };

      const name = getVal(['full name', 'name']);
      if (!name) continue;

      const email = getVal(['email']).toLowerCase().trim();
      const rawPhone = getVal(['mobile 1', 'phone', 'mobile']);
      const phoneDigits = rawPhone.replace(/[^0-9]/g, '');

      const key = `${email || ''}|${phoneDigits.slice(-8) || ''}|${name.toLowerCase()}`;

      if (!candidateMap.has(key)) {
        candidateMap.set(key, {
          name,
          phoneNumber: rawPhone,
          secondaryPhone: getVal(['mobile 2', 'secondary phone']),
          email,
          gender: getVal(['gender']),
          dateOfBirth: getVal(['date of birth', 'dob']),
          age: getVal(['age']),
          nationality: getVal(['nationality']),
          address: getVal(['address']),
          city: getVal(['city']),
          country: getVal(['country', 'location']) || 'United Arab Emirates',
          designation: getVal(['current position', 'designation', 'role']),
          appliedPost: getVal(['applied post', 'job listing', 'listing']),
          fieldOfExperience: getVal(['field of experience', 'domain']),
          fieldOfStudy: getVal(['field of study', 'specialisation']),
          totalExperienceYears: getVal(['total years experience', 'total experience', 'experience']),
          dubaiExperienceYears: getVal(['dubai experience (yrs)', 'dubai experience']),
          previousEmployers: getVal(['previous employers', 'companies']),
          education: getVal(['highest education', 'education']),
          summary: getVal(['summary']),
          skills: getVal(['skills']),
          linkedin: getVal(['linkedin']),
          instagram: getVal(['instagram']),
          facebook: getVal(['facebook']),
          otherSocialLink: getVal(['other social', 'social link']),
          visaStatus: getVal(['visa status', 'visa']),
          visaExpiryDate: getVal(['visa expiry']),
          spouseVisa: getVal(['spouse visa']),
          visaSponsorName: getVal(['visa sponsor']),
          noticePeriod: getVal(['notice period', 'availability']),
          salaryExpectations: getVal(['salary expectations', 'expected salary']),
          cvUrl: getVal(['cv url', 'cv link', 'download link'])
        });
        added++;
      }
    }
    console.log(`  └─ Loaded ${added} records from ${f}`);
  }

  const allCandidates = Array.from(candidateMap.values());
  console.log(`\nTotal Unique Candidates from Excel: ${allCandidates.length}`);

  // Fetch Existing CRM Signatures
  console.log('\nFetching existing CRM items to skip duplicates...');
  const existingSignatures = new Set();
  let start = 0;

  while (true) {
    const listUrl = `${webhookUrl}/crm.item.list?entityTypeId=${entityTypeId}&start=${start}&select[0]=title&select[1]=ufCrm32_1760525672592&select[2]=ufCrm32_1760525678896`;
    try {
      const res = await fetch(listUrl).then((r) => r.json());
      if (!res.result || !res.result.items || !res.result.items.length) break;

      for (const item of res.result.items) {
        const email = String(item.ufCrm32_1760525678896 || '').toLowerCase().trim();
        const phone = String(item.ufCrm32_1760525672592 || '').replace(/[^0-9]/g, '');
        const title = String(item.title || '').toLowerCase().trim();

        if (email) existingSignatures.add(`email:${email}`);
        if (phone.length >= 6) existingSignatures.add(`phone:${phone.slice(-8)}`);
        if (title) existingSignatures.add(`title:${title}`);
      }

      if (!res.next) break;
      start = res.next;
    } catch (err) {
      console.warn('Signature fetch note:', err.message);
      break;
    }
  }

  console.log(`Found ${existingSignatures.size} existing candidate signatures in Bitrix24 CRM.`);

  // Filter out candidates already in CRM
  const toPush = [];
  for (const cand of allCandidates) {
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

    if (!isDuplicate) {
      toPush.push(cand);
      if (emailKey) existingSignatures.add(emailKey);
      if (phoneKey) existingSignatures.add(phoneKey);
      existingSignatures.add(titleKey);
    }
  }

  console.log(`\nNew candidates to push into Bitrix24 CRM: ${toPush.length}`);
  if (toPush.length === 0) {
    console.log('All candidates are already present in Bitrix24 CRM! No new records needed.');
    return;
  }

  // Push in batches of 40 (Bitrix batch limit is 50)
  const BATCH_SIZE = 40;
  let pushedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < toPush.length; i += BATCH_SIZE) {
    const chunk = toPush.slice(i, i + BATCH_SIZE);
    const cmd = {};

    chunk.forEach((cand, idx) => {
      const payload = buildCandidatePayload(cand);
      const params = new URLSearchParams();
      params.append('entityTypeId', entityTypeId);
      for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined && v !== null && v !== '') {
          params.append(`fields[${k}]`, v);
        }
      }
      cmd[`item_${idx}`] = `crm.item.add?` + params.toString();
    });

    let success = false;
    let attempts = 0;

    while (!success && attempts < 4) {
      attempts++;
      try {
        const res = await fetch(`${webhookUrl}/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ halt: 0, cmd })
        });
        const data = await res.json();

        if (data.error && data.error.includes('QUERY_LIMIT_EXCEEDED')) {
          console.log(`[Rate limited] Waiting 2s before retry...`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        if (data.result && data.result.result) {
          const results = data.result.result;
          const successfulInBatch = Object.values(results).filter((r) => r && r.item && r.item.id).length;
          pushedCount += successfulInBatch;
          failedCount += chunk.length - successfulInBatch;
          success = true;
          console.log(
            `[${pushedCount}/${toPush.length}] Pushed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
              toPush.length / BATCH_SIZE
            )} (${successfulInBatch} created)`
          );
        } else {
          console.warn(`Batch response warning:`, data.error_description || data.error);
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err) {
        console.warn(`Network error in batch ${Math.floor(i / BATCH_SIZE) + 1}:`, err.message);
        await new Promise((r) => setTimeout(r, 1500 * attempts));
      }
    }

    // Delay between batch requests to respect Bitrix rate limits (2 req/sec)
    await new Promise((r) => setTimeout(r, 550));
  }

  console.log('\n=== Batch Sync Completed ===');
  console.log(`Total New Pushed: ${pushedCount}`);
  console.log(`Failed: ${failedCount}`);
}

fastSync().catch((err) => {
  console.error('Fatal error in fast sync:', err);
  process.exit(1);
});
