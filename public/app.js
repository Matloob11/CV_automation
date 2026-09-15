const form = document.querySelector('#uploadForm');
const fileInput = document.querySelector('#cvs');
const folderInput = document.querySelector('#folderCvs');
const fileMeta = document.querySelector('#fileMeta');
const folderMeta = document.querySelector('#folderMeta');
const extractButton = document.querySelector('#extractButton');
const downloadButton = document.querySelector('#downloadButton');
const failedFilesButton = document.querySelector('#failedFilesButton');
const failedFilesDialog = document.querySelector('#failedFilesDialog');
const closeFailedDialogButton = document.querySelector('#closeFailedDialog');
const failedFilesSummary = document.querySelector('#failedFilesSummary');
const failedFilesList = document.querySelector('#failedFilesList');
const resultsBody = document.querySelector('#resultsBody');
const summaryStrip = document.querySelector('#summaryStrip');
const statusCount = document.querySelector('#statusCount');
const processedCount = document.querySelector('#processedCount');
const successCount = document.querySelector('#successCount');
const failedCount = document.querySelector('#failedCount');
const groupedCount = document.querySelector('#groupedCount');
const currentFile = document.querySelector('#currentFile');
const progressFill = document.querySelector('#progressFill');
const mobileResults = document.querySelector('#mobileResults');
const serverStatus = document.querySelector('#serverStatus');

let latestDownloadUrl = '';
let latestDownloadName = 'cv-extraction.xlsx';
let pollTimer = null;
let lastRenderedRevision = -1;
let serverMaxFileBytes = 100 * 1024 * 1024;
let latestFailedRows = [];

loadHealth();
loadCrmStages();
restoreRememberedJob();

fileInput.addEventListener('change', updateFileMeta);
folderInput.addEventListener('change', updateFileMeta);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const selectedFiles = collectSelectedFiles();

  if (!selectedFiles.length) {
    showEmpty('Please choose CV files or a CV folder.');
    return;
  }

  clearPolling();
  setLoading(true);
  latestDownloadUrl = '';
  downloadButton.disabled = true;
  showEmpty(`Preparing ${selectedFiles.length} CV file${selectedFiles.length === 1 ? '' : 's'}...`);

  try {
    const bitrixStageSelect = document.querySelector('#bitrixStage');
    const stageId = bitrixStageSelect ? bitrixStageSelect.value : 'DT1156_44:NEW';
    const batch = await createBatch({
      appliedPost: document.querySelector('#appliedPost').value.trim(),
      stageId,
      expectedTotal: selectedFiles.length
    });

    rememberJob(batch.jobId);
    renderJob(batch);
    pollJob(batch.jobId);
    await uploadFilesSequentially(batch.jobId, selectedFiles);
    const started = await startBatch(batch.jobId);
    renderJob(started);
  } catch (error) {
    setLoading(false);
    latestDownloadUrl = '';
    downloadButton.disabled = true;
    showEmpty(error.message || 'Something went wrong.');
  }
});

downloadButton.addEventListener('click', () => {
  if (!latestDownloadUrl) return;
  const link = document.createElement('a');
  link.href = latestDownloadUrl;
  link.download = latestDownloadName;
  link.click();
});

failedFilesButton.addEventListener('click', openFailedFilesDialog);
closeFailedDialogButton.addEventListener('click', () => failedFilesDialog.close());
failedFilesDialog.addEventListener('click', (event) => {
  if (event.target === failedFilesDialog) failedFilesDialog.close();
});

async function loadHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    serverMaxFileBytes = (data.maxFileSizeMb || 100) * 1024 * 1024;
    const aiWorkers = Number(data.processingConcurrency || 1);
    const cacheWorkers = Number(data.cacheConcurrency || aiWorkers);
    serverStatus.textContent = `${cacheWorkers} cache / ${aiWorkers} AI workers`;
  } catch {
    serverStatus.textContent = 'Server offline';
  }
}

async function loadCrmStages() {
  const select = document.querySelector('#bitrixStage');
  if (!select) return;
  try {
    const res = await fetch('/api/crm/stages');
    const data = await res.json();
    if (data.ok && Array.isArray(data.stages) && data.stages.length > 0) {
      const currentValue = select.value;
      select.innerHTML = data.stages
        .map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === currentValue ? 'selected' : ''}>${escapeHtml(s.name)}</option>`)
        .join('');
      if (data.stages.some((s) => s.id === currentValue)) {
        select.value = currentValue;
      }
    }
  } catch {
    // Keep fallback static options
  }
}

async function restoreRememberedJob() {
  const queryJobId = new URLSearchParams(window.location.search).get('job');
  let storedJobId = '';
  try {
    storedJobId = window.localStorage.getItem('cvAutoLatestJobId') || '';
  } catch {
    storedJobId = '';
  }
  const jobId = queryJobId || storedJobId;
  if (!/^[a-zA-Z0-9T-]+$/.test(jobId)) return;

  try {
    const response = await fetch(`/api/jobs/${jobId}`);
    const job = await readApiJson(response, 'Could not restore the previous job.');
    rememberJob(jobId, false);
    renderJob(job);
    if (!['completed', 'failed'].includes(job.status)) {
      setLoading(true);
      pollJob(jobId);
    }
  } catch {
    // A missing or expired job should not block a new upload.
  }
}

function rememberJob(jobId, updateAddress = true) {
  if (!/^[a-zA-Z0-9T-]+$/.test(jobId)) return;
  try {
    window.localStorage.setItem('cvAutoLatestJobId', jobId);
  } catch {
    // The URL still preserves the job when browser storage is unavailable.
  }
  if (updateAddress) {
    const url = new URL(window.location.href);
    url.searchParams.set('job', jobId);
    window.history.replaceState({}, '', url);
  }
}

function updateFileMeta() {
  const fileFiles = supportedFiles(fileInput.files);
  const folderFiles = supportedFiles(folderInput.files);
  fileMeta.textContent = fileFiles.length
    ? selectionLabel(fileFiles, 'file')
    : 'PDF, DOCX, XLSX, CSV, TXT, Images supported';
  folderMeta.textContent = folderFiles.length
    ? `${selectionLabel(folderFiles, 'folder file')} - image pages auto-grouped`
    : 'Image pages are grouped by candidate';
}

function collectSelectedFiles() {
  return [...supportedFiles(fileInput.files), ...supportedFiles(folderInput.files)].sort((a, b) =>
    fileDisplayName(a).localeCompare(fileDisplayName(b))
  );
}

function supportedFiles(files) {
  const supported = /\.(pdf|doc|docx|txt|png|jpe?g|webp|md|rtf|xlsx|xls|csv)$/i;
  return [...files].filter((file) => supported.test(file.name));
}

function selectionLabel(files, noun) {
  const overLimit = files.filter((file) => file.size > serverMaxFileBytes).length;
  const fileText = `${files.length} ${noun}${files.length === 1 ? '' : 's'} selected`;
  return overLimit
    ? `${fileText} - ${overLimit} over ${formatBytes(serverMaxFileBytes)} will be skipped`
    : fileText;
}

async function pollJob(jobId) {
  pollTimer = window.setInterval(async () => {
    try {
      const response = await fetch(`/api/jobs/${jobId}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Could not load job status.');
      }
      renderJob(data);
      if (data.status === 'completed' || data.status === 'failed') {
        clearPolling();
        setLoading(false);
      }
    } catch (error) {
      clearPolling();
      setLoading(false);
      showEmpty(error.message || 'Could not load job status.');
    }
  }, 1500);
}

async function createBatch({ appliedPost, stageId, expectedTotal }) {
  const response = await fetch('/api/batches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appliedPost, stageId, expectedTotal })
  });
  return readApiJson(response, 'Could not create upload batch.');
}

async function uploadFilesSequentially(jobId, files) {
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const displayName = fileDisplayName(file);
    currentFile.textContent = `Uploading ${index + 1} of ${files.length}: ${trimMiddle(displayName, 34)}`;
    statusCount.textContent = 'uploading';

    if (file.size > serverMaxFileBytes) {
      const skipped = await skipFileInBatch(
        jobId,
        file,
        `File too large: ${formatBytes(file.size)}. Limit is ${formatBytes(serverMaxFileBytes)}.`
      );
      renderJob(skipped);
      continue;
    }

    try {
      const uploaded = await uploadFileToBatch(jobId, file);
      renderJob(uploaded);
    } catch (error) {
      const skipped = await skipFileInBatch(jobId, file, error.message || 'Upload failed.');
      renderJob(skipped);
    }
  }
}

async function uploadFileToBatch(jobId, file) {
  const formData = new FormData();
  formData.append('cv', file, fileDisplayName(file));
  const response = await fetch(`/api/batches/${jobId}/files`, {
    method: 'POST',
    body: formData
  });
  return readApiJson(response, `Could not upload ${fileDisplayName(file)}.`);
}

async function skipFileInBatch(jobId, file, error) {
  const response = await fetch(`/api/batches/${jobId}/skip-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      originalname: fileDisplayName(file),
      size: file.size,
      error
    })
  });
  return readApiJson(response, `Could not skip ${fileDisplayName(file)}.`);
}

function fileDisplayName(file) {
  return file.webkitRelativePath || file.name;
}

async function startBatch(jobId) {
  const response = await fetch(`/api/batches/${jobId}/start`, {
    method: 'POST'
  });
  return readApiJson(response, 'Could not start CV processing.');
}

async function readApiJson(response, fallbackMessage) {
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data.error || fallbackMessage);
  }
  return data;
}

function renderJob(data) {
  const rows = data.rows || [];
  const jobFinished = data.status === 'completed' || data.status === 'failed';
  const successfulRows = rows.filter((row) => row.status === 'ok' && hasUsableCandidateDetails(row));
  const failedRows = rows.filter(
    (row) => row.status === 'failed' || (jobFinished && row.status === 'ok' && !hasUsableCandidateDetails(row))
  );

  summaryStrip.hidden = false;
  statusCount.textContent = data.status || 'processing';
  const total = data.total || data.processed || 0;
  const processed = data.processed || 0;
  processedCount.textContent = `${processed} / ${total}`;
  successCount.textContent = `${successfulRows.length}`;
  failedCount.textContent = `${Math.max(Number(data.failed || 0), failedRows.length)}`;
  groupedCount.textContent = `${data.groupedPages || 0}`;
  currentFile.textContent = data.currentFile
    ? trimMiddle(data.currentFile, 44)
    : data.status === 'completed'
      ? 'Download ready'
      : data.storageFolder || 'Waiting';
  progressFill.style.width = total ? `${Math.min(100, Math.round((processed / total) * 100))}%` : '0%';

  latestDownloadUrl = data.downloadUrl || '';
  latestDownloadName = data.downloadFileName || latestDownloadName;
  downloadButton.disabled = !latestDownloadUrl;
  latestFailedRows = failedRows;
  failedFilesButton.hidden = !(jobFinished && failedRows.length);
  failedFilesButton.textContent = `Failed Files (${failedRows.length})`;

  const renderRevision = data.rowsVersion ?? data.processed ?? rows.length;
  if (renderRevision !== lastRenderedRevision || data.status === 'completed' || data.status === 'failed') {
    lastRenderedRevision = renderRevision;
    renderRows(successfulRows, data.status, failedRows.length);
  }
}

function setLoading(isLoading) {
  extractButton.disabled = isLoading;
  extractButton.textContent = isLoading ? 'Processing...' : 'Extract Data';
}

function renderRows(rows, status = '', failedTotal = 0) {
  if (!rows.length) {
    const message =
      status === 'queued'
        ? 'Queued. Processing will start in a moment.'
        : status === 'completed' && failedTotal > 0
          ? 'No usable candidate details were extracted.'
          : 'Waiting for extracted rows.';
    resultsBody.innerHTML = `<tr><td colspan="11" class="empty-state">${escapeHtml(
      message
    )}</td></tr>`;
    renderMobileCards([], message);
    return;
  }

  resultsBody.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="candidate-cell">
        <strong>${escapeHtml(row.name || 'Not found')}</strong>
        <span>${escapeHtml(candidateMeta(row))}</span>
      </td>
      <td class="nowrap">${escapeHtml(row.phoneNumber)}</td>
      <td>${escapeHtml(row.gender)}</td>
      <td>${escapeHtml(row.dateOfBirth)}</td>
      <td>${escapeHtml(row.totalExperienceYears)}</td>
      <td class="detail-cell">${escapeHtml(row.education)}</td>
      <td>${escapeHtml(row.designation)}</td>
      <td>${escapeHtml(row.appliedPost)}</td>
      <td>${escapeHtml(row.city)}</td>
      <td class="detail-cell">${escapeHtml(row.address)}</td>
      <td class="summary-cell">${escapeHtml(row.summary || row.error)}</td>
    `;
    resultsBody.appendChild(tr);
  }
  renderMobileCards(rows);
}

function renderMobileCards(rows, emptyMessage = 'Upload CVs to see extracted candidate details.') {
  if (!rows.length) {
    mobileResults.innerHTML = `<div class="empty-card">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  mobileResults.innerHTML = rows
    .map(
      (row) => `
        <article class="candidate-card">
          <header>
            <div class="avatar">${initials(row.name)}</div>
            <div>
              <h2>${escapeHtml(row.name || 'Not found')}</h2>
              <span>${escapeHtml(candidateMeta(row))}</span>
            </div>
          </header>
          ${mobileField('Phone', row.phoneNumber)}
          ${mobileField('Gender', row.gender)}
          ${mobileField('DOB', row.dateOfBirth)}
          ${mobileField('Total Experience', row.totalExperienceYears)}
          ${mobileField('Education', row.education)}
          ${mobileField('Designation', row.designation)}
          ${mobileField('Applied Post', row.appliedPost)}
          ${mobileField('City', row.city)}
          ${mobileField('Address', row.address)}
          ${mobileField('Summary', row.summary || row.error, true)}
        </article>
      `
    )
    .join('');
}

function showEmpty(message) {
  summaryStrip.hidden = true;
  lastRenderedRevision = -1;
  latestFailedRows = [];
  failedFilesButton.hidden = true;
  if (failedFilesDialog.open) failedFilesDialog.close();
  resultsBody.innerHTML = `<tr><td colspan="11" class="empty-state">${escapeHtml(message)}</td></tr>`;
  mobileResults.innerHTML = `<div class="empty-card">${escapeHtml(message)}</div>`;
}

function openFailedFilesDialog() {
  if (!latestFailedRows.length) return;
  failedFilesSummary.textContent = `${latestFailedRows.length} file${latestFailedRows.length === 1 ? '' : 's'} could not be added to candidate results.`;
  failedFilesList.innerHTML = latestFailedRows
    .map(
      (row, index) => `
        <div class="failed-file-row">
          <span>${index + 1}</span>
          <div>
            <strong>${escapeHtml(failedFileName(row))}</strong>
            <p>${escapeHtml(failureReason(row))}</p>
          </div>
        </div>
      `
    )
    .join('');
  failedFilesDialog.showModal();
}

function failedFileName(row) {
  return row.sourceFile || row.name || 'Unknown file';
}

function failureReason(row) {
  const reason = String(row.error || row.rejectionReason || row.summary || '').trim();
  if (/429|rate limit/i.test(reason)) return 'OpenAI rate limit was reached after retries.';
  if (/timed? out|timeout/i.test(reason)) return 'Processing timed out after retries.';
  if (/too large|file size|per-file limit/i.test(reason)) return 'File exceeded the allowed size limit.';
  if (/no clear candidate details/i.test(reason)) return 'No clear candidate details were found.';
  if (/not.*(?:cv|resume)|does not appear/i.test(reason)) return 'The file was not recognized as a CV.';
  return reason || 'Candidate details could not be extracted.';
}

function hasUsableCandidateDetails(row) {
  const name = String(row.name || '').trim();
  const usableName = Boolean(name) && !/\.(?:pdf|docx?|txt|rtf|md|png|jpe?g|webp)$/i.test(name);
  const hasPhone = Boolean(String(row.phoneNumber || '').trim());
  const hasEmail = Boolean(String(row.email || '').trim());
  const supportingFields = [
    'dateOfBirth',
    'address',
    'designation',
    'city',
    'skills',
    'totalExperienceYears',
    'education'
  ];
  const supportingCount = supportingFields.filter((field) => String(row[field] || '').trim()).length;

  if (usableName && (hasPhone || hasEmail || supportingCount > 0)) return true;
  if (hasPhone && hasEmail) return true;
  if ((hasPhone || hasEmail) && supportingCount > 0) return true;
  return Boolean(
    row.isContinuationPage === true &&
      Number(row.continuationConfidence || 0) >= 0.72 &&
      supportingCount > 0
  );
}

function candidateMeta(row) {
  const pageCount = Number(row.pageCount || 1);
  const pages = pageCount > 1 ? `${pageCount} pages` : '';
  return [row.email || row.sourceFile || '', pages].filter(Boolean).join(' - ');
}

function clearPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function trimMiddle(value, maxLength) {
  const text = String(value);
  if (text.length <= maxLength) return text;
  const edge = Math.floor((maxLength - 3) / 2);
  return `${text.slice(0, edge)}...${text.slice(-edge)}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function mobileField(label, value, isLong = false) {
  return `
    <div class="mobile-field${isLong ? ' long' : ''}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || '-')}</strong>
    </div>
  `;
}

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const text = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : (parts[0] || 'CV').slice(0, 2);
  return escapeHtml(text.toUpperCase());
}
