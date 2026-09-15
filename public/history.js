const searchForm = document.querySelector('#historySearchForm');
const searchInput = document.querySelector('#historySearch');
const pageSizeSelect = document.querySelector('#historyPageSize');
const resultsBody = document.querySelector('#historyResultsBody');
const mobileResults = document.querySelector('#historyMobileResults');
const totalCount = document.querySelector('#historyTotal');
const allTotalCount = document.querySelector('#historyAllTotal');
const batchCount = document.querySelector('#historyBatchCount');
const pageLabel = document.querySelector('#historyPageLabel');
const resultWindow = document.querySelector('#historyResultWindow');
const previousButton = document.querySelector('#previousHistoryPage');
const nextButton = document.querySelector('#nextHistoryPage');
const rangeForm = document.querySelector('#rangeDownloadForm');
const rangeFrom = document.querySelector('#rangeFrom');
const rangeTo = document.querySelector('#rangeTo');
const rangeButton = document.querySelector('#downloadRangeButton');
const message = document.querySelector('#historyMessage');
const liveStatus = document.querySelector('#historyLiveStatus');
const syncAllCrmBtn = document.querySelector('#syncAllCrmButton');

async function loadHistoryCrmStages() {
  const select = document.querySelector('#historyCrmStage');
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
loadHistoryCrmStages();

if (syncAllCrmBtn) {
  syncAllCrmBtn.addEventListener('click', async () => {
    const stageSelect = document.querySelector('#historyCrmStage');
    const stageName = stageSelect ? stageSelect.options[stageSelect.selectedIndex]?.text || '' : '';
    if (!confirm(`Start syncing all unsynced candidates to Bitrix24 CRM (${stageName})?`)) return;
    syncAllCrmBtn.disabled = true;
    syncAllCrmBtn.textContent = 'Syncing...';
    showMessage('Starting background CRM sync... Please wait or check Bitrix24.');
    try {
      const stageId = stageSelect ? stageSelect.value : 'DT1156_44:NEW';
      const res = await fetch('/api/crm/sync-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageId })
      });
      const data = await readJson(res);
      showMessage(data.message || 'Sync operation started successfully.');
    } catch (err) {
      showMessage(err.message || 'Bulk sync request failed.');
    } finally {
      syncAllCrmBtn.disabled = false;
      syncAllCrmBtn.textContent = 'Sync All to CRM';
    }
  });
}

const state = {
  page: 1,
  pageSize: Number(pageSizeSelect.value),
  search: '',
  total: 0,
  totalPages: 1,
  maxRange: 500,
  loading: false,
  rangeTouched: false,
  request: null,
  debounceTimer: null
};

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeout(state.debounceTimer);
  applySearch();
});

searchInput.addEventListener('input', () => {
  clearTimeout(state.debounceTimer);
  state.debounceTimer = window.setTimeout(applySearch, 350);
});

pageSizeSelect.addEventListener('change', () => {
  state.pageSize = Number(pageSizeSelect.value);
  state.page = 1;
  loadCandidates();
});

previousButton.addEventListener('click', () => {
  if (state.page <= 1) return;
  state.page -= 1;
  loadCandidates();
});

nextButton.addEventListener('click', () => {
  if (state.page >= state.totalPages) return;
  state.page += 1;
  loadCandidates();
});

rangeFrom.addEventListener('input', () => {
  state.rangeTouched = true;
});
rangeTo.addEventListener('input', () => {
  state.rangeTouched = true;
});

rangeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const from = Number(rangeFrom.value);
  const to = Number(rangeTo.value);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > state.total) {
    showMessage(`Choose a range between 1 and ${state.total}.`);
    return;
  }
  if (to - from + 1 > state.maxRange) {
    showMessage(`Choose up to ${state.maxRange} candidates in one range.`);
    return;
  }

  hideMessage();
  const params = new URLSearchParams({ from: String(from), to: String(to) });
  if (state.search) params.set('search', state.search);
  triggerDownload(`/api/candidates/download-range?${params}`);
});

loadCandidates();
window.setInterval(() => {
  if (!document.hidden && !state.loading) loadCandidates({ background: true });
}, 15000);

function applySearch() {
  const search = searchInput.value.trim();
  if (search === state.search) return;
  state.search = search;
  state.page = 1;
  state.rangeTouched = false;
  loadCandidates();
}

async function loadCandidates({ background = false } = {}) {
  state.request?.abort();
  const request = new AbortController();
  state.request = request;
  state.loading = true;
  if (!background) {
    liveStatus.textContent = 'Loading history';
    renderLoading();
  }

  try {
    const params = new URLSearchParams({
      page: String(state.page),
      pageSize: String(state.pageSize)
    });
    if (state.search) params.set('search', state.search);
    const response = await fetch(`/api/candidates?${params}`, { signal: request.signal });
    const data = await readJson(response);
    state.page = data.page;
    state.total = data.total;
    state.totalPages = data.totalPages;
    state.maxRange = data.maxDownloadCandidates || 500;
    renderHistory(data);
    hideMessage();
    liveStatus.textContent = 'Live history';
  } catch (error) {
    if (error.name !== 'AbortError') {
      showMessage(error.message || 'Could not load candidate history.');
      liveStatus.textContent = 'History unavailable';
    }
  } finally {
    if (state.request === request) state.loading = false;
  }
}

function renderHistory(data) {
  totalCount.textContent = String(data.total);
  allTotalCount.textContent = String(data.totalAll);
  batchCount.textContent = String(data.batchCount);
  pageLabel.textContent = `Page ${data.page} of ${data.totalPages}`;
  const first = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const last = data.total ? first + data.items.length - 1 : 0;
  resultWindow.textContent = data.total ? `${first}-${last} of ${data.total}` : '0 results';
  previousButton.disabled = data.page <= 1;
  nextButton.disabled = data.page >= data.totalPages;

  updateRange(data.total);
  renderDesktopRows(data.items);
  renderMobileRows(data.items);
}

function updateRange(total) {
  rangeFrom.max = String(Math.max(1, total));
  rangeTo.max = String(Math.max(1, total));
  rangeButton.disabled = total === 0;
  if (!state.rangeTouched || Number(rangeFrom.value) > total || Number(rangeTo.value) > total) {
    rangeFrom.value = total ? '1' : '0';
    rangeTo.value = total ? String(Math.min(total, state.maxRange, 50)) : '0';
    state.rangeTouched = false;
  }
}

function renderDesktopRows(items) {
  if (!items.length) {
    resultsBody.innerHTML = '<tr><td colspan="9" class="empty-state">No matching candidates found.</td></tr>';
    return;
  }

  resultsBody.innerHTML = items
    .map(
      (candidate) => `
        <tr>
          <td class="candidate-cell">
            <strong><span class="history-position">#${candidate.position}</span>${escapeHtml(candidate.name)}</strong>
            <span>${escapeHtml(candidate.email || candidate.sourceFile)}</span>
          </td>
          <td class="nowrap">${escapeHtml(candidate.phoneNumber || '-')}</td>
          <td>${escapeHtml(candidate.designation || '-')}</td>
          <td>${escapeHtml(candidate.appliedPost || '-')}</td>
          <td>${escapeHtml(candidate.city || '-')}</td>
          <td>${escapeHtml(candidate.totalExperienceYears || '-')}</td>
          <td class="nowrap">${escapeHtml(formatDate(candidate.processedAt))}</td>
          <td>${crmCell(candidate)}</td>
          <td>${downloadLink(candidate)}</td>
        </tr>
      `
    )
    .join('');

  attachCrmButtonListeners();
}

function renderMobileRows(items) {
  if (!items.length) {
    mobileResults.innerHTML = '<div class="empty-card">No matching candidates found.</div>';
    return;
  }

  mobileResults.innerHTML = items
    .map(
      (candidate) => `
        <article class="candidate-card history-candidate-card">
          <header>
            <div class="avatar">${initials(candidate.name)}</div>
            <div>
              <h2><span class="history-position">#${candidate.position}</span>${escapeHtml(candidate.name)}</h2>
              <span>${escapeHtml(candidate.email || candidate.sourceFile)}</span>
            </div>
          </header>
          ${mobileField('Phone', candidate.phoneNumber)}
          ${mobileField('Designation', candidate.designation)}
          ${mobileField('Applied Post', candidate.appliedPost)}
          ${mobileField('City', candidate.city)}
          ${mobileField('Total Experience', candidate.totalExperienceYears)}
          ${mobileField('Processed', formatDate(candidate.processedAt))}
          ${mobileField('Bitrix CRM', crmCell(candidate))}
          <div class="history-card-action">${downloadLink(candidate)}</div>
        </article>
      `
    )
    .join('');

  attachCrmButtonListeners();
}

function crmCell(candidate) {
  if (candidate.crmSynced && candidate.crmId) {
    return `<a class="status-pill ok" href="https://crm.a7grouprealestatedxb.com/page/hr/applicant/" target="_blank" title="Item #${candidate.crmId}">Bitrix #${candidate.crmId}</a>`;
  }
  return `<button class="compact-button secondary-button crm-single-sync" data-id="${candidate.id}" type="button">Sync CRM</button>`;
}

function attachCrmButtonListeners() {
  document.querySelectorAll('.crm-single-sync').forEach((btn) => {
    btn.onclick = async (e) => {
      e.preventDefault();
      const id = btn.getAttribute('data-id');
      const stageSelect = document.querySelector('#historyCrmStage');
      const stageId = stageSelect ? stageSelect.value : 'DT1156_44:NEW';
      btn.disabled = true;
      btn.textContent = 'Syncing...';
      try {
        const res = await fetch(`/api/candidates/${id}/sync-crm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stageId })
        });
        const data = await readJson(res);
        if (data.ok) {
          btn.outerHTML = `<a class="status-pill ok" href="https://crm.a7grouprealestatedxb.com/page/hr/applicant/" target="_blank">Bitrix #${data.crmId}</a>`;
        }
      } catch (err) {
        alert(err.message || 'Sync failed.');
        btn.disabled = false;
        btn.textContent = 'Sync CRM';
      }
    };
  });
}

function renderLoading() {
  resultsBody.innerHTML = '<tr><td colspan="9" class="empty-state">Loading candidate history.</td></tr>';
  mobileResults.innerHTML = '<div class="empty-card">Loading candidate history.</div>';
}

function downloadLink(candidate) {
  if (!candidate.hasDownload) return '<span class="download-unavailable">Unavailable</span>';
  return `<a class="row-download" href="${escapeHtml(candidate.downloadUrl)}">Download</a>`;
}

function fileLabel(candidate) {
  const count = Number(candidate.pageCount || candidate.sourceFiles?.length || 1);
  const pages = `${count} ${count === 1 ? 'file' : 'files'}`;
  const source = candidate.sourceFiles?.[0] || candidate.sourceFile || '';
  return source ? `${pages} - ${source}` : pages;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

async function readJson(response) {
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function triggerDownload(url) {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
}

function hideMessage() {
  message.hidden = true;
  message.textContent = '';
}

function mobileField(label, value) {
  return `
    <div class="mobile-field">
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

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
