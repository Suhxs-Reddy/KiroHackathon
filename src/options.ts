/**
 * options.ts — Merged settings page
 * Handles: AI engine config, jurisdiction selection, bookmarks, breach cache.
 */

const BOOKMARKS_KEY = 'dg_bookmarked_sites';
const JURISDICTION_KEY = 'dg_user_jurisdiction';

// ─── AI Engine Configuration (Req 3) ─────────────────────────────────────────

const adapterTypeSelect = document.getElementById('adapter-type') as HTMLSelectElement;
const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
const saveAiBtn = document.getElementById('save-ai-btn') as HTMLButtonElement;
const aiStatusDiv = document.getElementById('ai-status') as HTMLDivElement;

async function loadAiSettings() {
  const storage = await chrome.storage.local.get(['apiKey', 'adapterType']);
  if (storage.apiKey) apiKeyInput.value = storage.apiKey;
  if (storage.adapterType) adapterTypeSelect.value = storage.adapterType;
}

saveAiBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  const adapterType = adapterTypeSelect.value as 'saulm' | 'openai';

  if (!apiKey) {
    showStatus(aiStatusDiv, 'Please enter an API key', 'error');
    return;
  }

  saveAiBtn.disabled = true;
  saveAiBtn.textContent = 'Validating...';
  aiStatusDiv.style.display = 'none';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'VALIDATE_API_KEY',
      payload: { apiKey, adapterType },
    });

    if (response.success) {
      showStatus(aiStatusDiv, '\u2713 API key saved and validated!', 'ok');
    } else {
      showStatus(aiStatusDiv, `Validation failed: ${response.error || 'Unknown error'}`, 'error');
    }
  } catch (error) {
    showStatus(aiStatusDiv, `Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    saveAiBtn.disabled = false;
    saveAiBtn.textContent = 'Save & Validate';
  }
});

loadAiSettings();

// ─── Jurisdiction Selection (Req 5.1) ─────────────────────────────────────────

const JURISDICTIONS = [
  { id: 'GDPR', label: 'GDPR \u2014 European Union / EEA' },
  { id: 'CCPA', label: 'CCPA \u2014 California, USA' },
  { id: 'CPRA', label: 'CPRA \u2014 California, USA (extends CCPA)' },
  { id: 'VCDPA', label: 'VCDPA \u2014 Virginia, USA' },
  { id: 'CPA', label: 'CPA \u2014 Colorado, USA' },
  { id: 'CTDPA', label: 'CTDPA \u2014 Connecticut, USA' },
];

const jurisdictionContainer = document.getElementById('jurisdiction-checkboxes')!;
const saveJurisdictionBtn = document.getElementById('save-jurisdiction-btn') as HTMLButtonElement;
const jurisdictionStatusDiv = document.getElementById('jurisdiction-status') as HTMLDivElement;

async function loadJurisdiction() {
  const result = await chrome.storage.local.get([JURISDICTION_KEY]);
  const saved: string[] = result[JURISDICTION_KEY] || [];

  jurisdictionContainer.innerHTML = '';
  for (const j of JURISDICTIONS) {
    const row = document.createElement('div');
    row.className = 'checkbox-row';
    row.innerHTML = `
      <input type="checkbox" id="j-${j.id}" value="${j.id}" ${saved.includes(j.id) ? 'checked' : ''} />
      <label for="j-${j.id}">${j.label}</label>
    `;
    jurisdictionContainer.appendChild(row);
  }
}

saveJurisdictionBtn.addEventListener('click', async () => {
  const checked: string[] = [];
  for (const j of JURISDICTIONS) {
    const cb = document.getElementById(`j-${j.id}`) as HTMLInputElement;
    if (cb.checked) checked.push(j.id);
  }
  await chrome.storage.local.set({ [JURISDICTION_KEY]: checked });
  showStatus(jurisdictionStatusDiv, `\u2713 Saved! ${checked.length} jurisdiction${checked.length !== 1 ? 's' : ''} selected.`, 'ok');
});

loadJurisdiction();

// ─── Bookmarks ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function renderBookmarks() {
  const container = document.getElementById('bookmarks-list')!;
  const result = await new Promise<Record<string, any>>(r => chrome.storage.local.get([BOOKMARKS_KEY], r));
  const bookmarks = result[BOOKMARKS_KEY] || {};
  const domains = Object.keys(bookmarks);

  if (domains.length === 0) {
    container.innerHTML = `<p class="empty-bookmarks">No bookmarked sites yet.<br>Click \u{1F516} Bookmark in the popup to add one.</p>`;
    return;
  }

  container.innerHTML = '';
  for (const domain of domains) {
    const entry = bookmarks[domain];
    const item = document.createElement('div');
    item.className = 'bookmark-item';
    item.innerHTML = `
      <div>
        <div class="bookmark-domain">\u{1F516} ${domain}</div>
        <div class="bookmark-meta">Added ${formatDate(entry.addedAt)} \u00B7 Last checked ${formatDate(entry.lastChecked)}</div>
      </div>
      <button class="bookmark-remove" data-domain="${domain}">Remove</button>
    `;
    container.appendChild(item);
  }

  container.querySelectorAll('.bookmark-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const result = await new Promise<Record<string, any>>(r => chrome.storage.local.get([BOOKMARKS_KEY], r));
      const bm = result[BOOKMARKS_KEY] || {};
      delete bm[(btn as HTMLElement).dataset.domain!];
      await new Promise<void>(r => chrome.storage.local.set({ [BOOKMARKS_KEY]: bm }, r));
      renderBookmarks();
    });
  });
}

renderBookmarks();

// ─── Breach Cache ─────────────────────────────────────────────────────────────

const statusEl = document.getElementById('cache-status')!;
const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement;

async function loadCacheStatus() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_CACHE_STATUS' });
    if (resp.hasCachedData) {
      statusEl.className = 'status ok';
      statusEl.textContent = `\u2713 ${resp.count.toLocaleString()} breaches cached \u00B7 ${resp.ageDays === 0 ? 'Updated today' : `${resp.ageDays} day${resp.ageDays !== 1 ? 's' : ''} ago`}${resp.isStale ? ' (stale \u2014 will refresh on next popup open)' : ''}`;
    } else {
      statusEl.className = 'status';
      statusEl.textContent = 'No cached data yet. Click "Refresh now" to fetch breach data.';
    }
  } catch (_) {
    statusEl.textContent = 'Unable to check cache status.';
  }
}

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing\u2026';
  statusEl.className = 'status';
  statusEl.textContent = 'Fetching from Have I Been Pwned\u2026';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'REFRESH_BREACH_CACHE' });
    if (resp.success) {
      statusEl.className = 'status ok';
      statusEl.textContent = `\u2713 Refreshed \u2014 ${resp.count.toLocaleString()} breaches cached.`;
    } else {
      statusEl.textContent = `Error: ${resp.error}`;
    }
  } catch (err) {
    statusEl.textContent = `Error: ${(err as Error).message}`;
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh now';
  }
});

loadCacheStatus();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showStatus(div: HTMLDivElement, text: string, type: 'ok' | 'error') {
  div.textContent = text;
  div.className = `status ${type}`;
  div.style.display = 'block';
}
