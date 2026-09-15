import fsp from 'node:fs/promises';
import path from 'node:path';

import { errorMessage, safeString } from '../lib/utils.js';

export function createBitrixAgent({ config }) {
  const webhookUrl = safeString(process.env.BITRIX24_WEBHOOK_URL || config?.bitrixWebhookUrl || '').trim();
  const entityTypeId = Number(config?.bitrixEntityTypeId || 1156);
  const defaultStageId = 'DT1156_44:NEW';

  function isConfigured() {
    return Boolean(webhookUrl && webhookUrl.startsWith('http'));
  }

  async function testConnection() {
    if (!isConfigured()) {
      return { ok: false, error: 'BITRIX24_WEBHOOK_URL is not configured.' };
    }
    try {
      const apiUrl = `${webhookUrl.replace(/\/+$/, '')}/profile`;
      const response = await fetch(apiUrl);
      const data = await response.json();
      if (data.result) {
        return { ok: true, user: data.result };
      }
      return { ok: false, error: data.error_description || 'Invalid response from Bitrix24 API.' };
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'Could not connect to Bitrix24 API.') };
    }
  }

  async function pushCandidate(candidate, options = {}) {
    if (!isConfigured()) {
      return { success: false, error: 'BITRIX24_WEBHOOK_URL is not configured in .env.' };
    }

    if (!candidate || !candidate.name) {
      return { success: false, error: 'Candidate name is required.' };
    }

    const { firstName, lastName } = splitName(candidate.name);
    const appliedRole = safeString(candidate.appliedPost || candidate.designation);
    const title = appliedRole ? `${candidate.name} - ${appliedRole}` : candidate.name;

    // Build clean structured CV card summary (omitting empty/null/missing fields)
    const cvLines = [];
    cvLines.push('📄 CANDIDATE CV PROFILE');
    cvLines.push('──────────────────────────────');
    if (candidate.name) cvLines.push(`• Full Name: ${candidate.name}`);
    if (appliedRole) cvLines.push(`• Position / Role: ${appliedRole}`);
    if (candidate.phoneNumber) cvLines.push(`• Mobile: ${candidate.phoneNumber}`);
    if (candidate.secondaryPhone) cvLines.push(`• Secondary Mobile: ${candidate.secondaryPhone}`);
    if (candidate.email) cvLines.push(`• Email: ${candidate.email}`);
    
    const personalInfo = [
      candidate.nationality ? `Nationality: ${candidate.nationality}` : '',
      candidate.age ? `Age: ${candidate.age}` : '',
      candidate.gender ? `Gender: ${candidate.gender}` : ''
    ].filter(Boolean).join(' | ');
    if (personalInfo) cvLines.push(`• Personal: ${personalInfo}`);

    const loc = [candidate.city, candidate.country, candidate.address].filter(Boolean).join(', ');
    if (loc) cvLines.push(`• Location: ${loc}`);

    const expDetails = [
      candidate.totalExperienceYears ? `Total: ${candidate.totalExperienceYears}` : '',
      candidate.dubaiExperienceYears ? `UAE / Dubai: ${candidate.dubaiExperienceYears}` : '',
      candidate.fieldOfExperience ? `Field: ${candidate.fieldOfExperience}` : ''
    ].filter(Boolean).join(' | ');
    if (expDetails) cvLines.push(`• Experience: ${expDetails}`);

    if (candidate.previousEmployers) cvLines.push(`• Previous Employers: ${candidate.previousEmployers}`);
    
    const eduDetails = [
      candidate.education ? candidate.education : '',
      candidate.fieldOfStudy ? `(${candidate.fieldOfStudy})` : ''
    ].filter(Boolean).join(' ');
    if (eduDetails) cvLines.push(`• Education: ${eduDetails}`);

    const visaDetails = [
      candidate.visaStatus ? `Status: ${candidate.visaStatus}` : '',
      candidate.visaExpiryDate ? `Expires: ${candidate.visaExpiryDate}` : '',
      candidate.spouseVisa ? `Spouse Visa: ${candidate.spouseVisa}` : '',
      candidate.visaSponsorName ? `Sponsor: ${candidate.visaSponsorName}` : ''
    ].filter(Boolean).join(' | ');
    if (visaDetails) cvLines.push(`• Visa: ${visaDetails}`);

    if (candidate.noticePeriod) cvLines.push(`• Notice Period: ${candidate.noticePeriod}`);
    if (candidate.salaryExpectations) cvLines.push(`• Salary Expectations: ${candidate.salaryExpectations}`);
    if (candidate.skills) cvLines.push(`• Skills: ${candidate.skills}`);
    if (candidate.summary) cvLines.push(`• Summary: ${candidate.summary}`);

    const socialLinks = [
      candidate.linkedin ? `LinkedIn: ${candidate.linkedin}` : '',
      candidate.instagram ? `Instagram: ${candidate.instagram}` : '',
      candidate.facebook ? `Facebook: ${candidate.facebook}` : '',
      candidate.otherSocialLink ? `Other: ${candidate.otherSocialLink}` : ''
    ].filter(Boolean).join(' | ');
    if (socialLinks) cvLines.push(`• Social: ${socialLinks}`);

    if (candidate.cvUrl) cvLines.push(`\n🔗 CV PDF Link:\n${candidate.cvUrl}`);
    if (candidate.sourceFile && !candidate.cvUrl) cvLines.push(`• Source File: ${candidate.sourceFile}`);

    // Format experience string for card badge (e.g., "3 years total | 3 years UAE" or "Fresh")
    let expText = '';
    if (candidate.totalExperienceYears || candidate.dubaiExperienceYears) {
      expText = [
        candidate.totalExperienceYears ? `${candidate.totalExperienceYears} total` : '',
        candidate.dubaiExperienceYears ? `${candidate.dubaiExperienceYears} UAE` : ''
      ].filter(Boolean).join(' | ');
    } else if (candidate.experience) {
      expText = safeString(candidate.experience);
    }
    if (!expText && candidate.fieldOfExperience) {
      expText = safeString(candidate.fieldOfExperience);
    }

    const fields = {
      stageId: options.stageId || defaultStageId,
      title: title.slice(0, 255),
      ufCrm32_1760525662256: firstName.slice(0, 100),
      ufCrm32_1760525666320: lastName.slice(0, 100),
      ufCrm32_1760525724346: expText.slice(0, 50),
      ufCrm32_1760525672592: safeString(candidate.phoneNumber).slice(0, 50),
      ufCrm32_1760525678896: safeString(candidate.email).slice(0, 100),
      ufCrm32_1760525687473: appliedRole.slice(0, 100),
      ufCrm32_1760525758: cvLines.join('\n')
    };

    // Attach CV File if available
    let filePath = options.filePath;
    let fileName = options.fileName || candidate.sourceFile;

    if (!filePath && options.resolveFilePath && typeof options.resolveFilePath === 'function') {
      try {
        const resolved = await options.resolveFilePath(candidate);
        if (resolved && resolved.length > 0) {
          filePath = resolved[0].path;
          fileName = resolved[0].downloadName || fileName;
        }
      } catch {
        // Continue without attachment if file resolution fails
      }
    }

    if (filePath) {
      try {
        const fileBuffer = await fsp.readFile(filePath);
        // Bitrix file field accepts [filename, base64]
        const cleanFileName = path.basename(fileName || 'resume.pdf');
        fields.ufCrm32_1760525745675 = [cleanFileName, fileBuffer.toString('base64')];
      } catch (err) {
        console.warn(`Could not attach file ${filePath} to Bitrix candidate:`, err.message);
      }
    }

    const apiUrl = `${webhookUrl.replace(/\/+$/, '')}/crm.item.add`;

    let attempts = 0;
    const maxAttempts = options.maxRetries || 3;

    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityTypeId,
            fields
          })
        });

        const data = await response.json();
        if (data.result && data.result.item && data.result.item.id) {
          return {
            success: true,
            crmId: data.result.item.id,
            stageId: data.result.item.stageId,
            item: data.result.item
          };
        }

        if (data.error && data.error.includes('QUERY_LIMIT_EXCEEDED')) {
          await sleep(1500 * attempts);
          continue;
        }

        return {
          success: false,
          error: data.error_description || data.error || 'Failed to add item to Bitrix24 CRM.'
        };
      } catch (error) {
        if (attempts >= maxAttempts) {
          return {
            success: false,
            error: errorMessage(error, 'Network error while calling Bitrix24 API.')
          };
        }
        await sleep(1000 * attempts);
      }
    }
  }

  const defaultStages = [
    { id: 'DT1156_44:NEW', name: 'Applied (New / Inbound)', color: '#22B9FF' },
    { id: 'DT1156_44:PREPARATION', name: '1st Stage - Initial Interview', color: '#88B9FF' },
    { id: 'DT1156_44:CLIENT', name: '2nd Stage - Interview', color: '#10e5fc' },
    { id: 'DT1156_44:1', name: 'Final Interview', color: '#39A8EF' },
    { id: 'DT1156_44:2', name: 'Hired', color: '#2FC6F6' },
    { id: 'DT1156_44:3', name: 'Rejected', color: '#55D0E0' }
  ];

  async function getStages() {
    if (!isConfigured()) return defaultStages;
    try {
      const apiUrl = `${webhookUrl.replace(/\/+$/, '')}/crm.status.list?filter[ENTITY_ID]=DYNAMIC_${entityTypeId}_STAGE_44`;
      const response = await fetch(apiUrl);
      const data = await response.json();
      if (Array.isArray(data.result) && data.result.length > 0) {
        return data.result.map((s) => ({
          id: s.STATUS_ID,
          name: s.NAME,
          color: s.COLOR,
          semantics: s.SEMANTICS
        }));
      }
      return defaultStages;
    } catch {
      return defaultStages;
    }
  }

  return {
    isConfigured,
    testConnection,
    pushCandidate,
    getStages,
    entityTypeId
  };
}

function splitName(fullName = '') {
  const clean = safeString(fullName).trim();
  if (!clean) return { firstName: '', lastName: '' };
  const parts = clean.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
