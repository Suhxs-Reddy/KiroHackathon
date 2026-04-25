'use strict'

const BOOKMARKS_KEY = 'dg_bookmarked_sites'
const statusEl = document.getElementById('cache-status')
const refreshBtn = document.getElementById('refresh-btn')

// ─── Bookmarks ────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

async function renderBookmarks() {
  const container = document.getElementById('bookmarks-list')
  const result = await new Promise(r => chrome.storage.local.get([BOOKMARKS_KEY], r))
  const bookmarks = result[BOOKMARKS_KEY] || {}
  const domains = Object.keys(bookmarks)

  if (domains.length === 0) {
    container.innerHTML = `<p class="empty-bookmarks">No bookmarked sites yet.<br>Click 🔖 Bookmark in the popup to add one.</p>`
    return
  }

  container.innerHTML = ''
  for (const domain of domains) {
    const entry = bookmarks[domain]
    const item = document.createElement('div')
    item.className = 'bookmark-item'
    item.innerHTML = `
      <div>
        <div class="bookmark-domain">🔖 ${domain}</div>
        <div class="bookmark-meta">Added ${formatDate(entry.addedAt)} · Last checked ${formatDate(entry.lastChecked)}</div>
      </div>
      <button class="bookmark-remove" data-domain="${domain}">Remove</button>
    `
    container.appendChild(item)
  }

  container.querySelectorAll('.bookmark-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const result = await new Promise(r => chrome.storage.local.get([BOOKMARKS_KEY], r))
      const bm = result[BOOKMARKS_KEY] || {}
      delete bm[btn.dataset.domain]
      await new Promise(r => chrome.storage.local.set({ [BOOKMARKS_KEY]: bm }, r))
      renderBookmarks()
    })
  })
}

renderBookmarks()

// ─── API Key Settings ─────────────────────────────────────────────────────────

const apiKeyInput = document.getElementById('api-key-input')
const adapterSelect = document.getElementById('adapter-type')
const saveApiKeyBtn = document.getElementById('save-api-key-btn')
const apiKeyStatus = document.getElementById('api-key-status')

// Load existing settings
chrome.storage.local.get(['apiKey', 'adapterType'], (result) => {
  if (result.apiKey) {
    apiKeyInput.value = result.apiKey
  }
  if (result.adapterType) {
    adapterSelect.value = result.adapterType
  }
})

saveApiKeyBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim()
  const adapterType = adapterSelect.value

  if (!apiKey) {
    apiKeyStatus.className = 'status'
    apiKeyStatus.textContent = 'Please enter an API key.'
    return
  }

  saveApiKeyBtn.disabled = true
  saveApiKeyBtn.textContent = 'Validating...'
  apiKeyStatus.className = 'status'
  apiKeyStatus.textContent = 'Testing API key...'

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'VALIDATE_API_KEY',
      payload: { apiKey, adapterType }
    })

    if (resp && resp.success) {
      apiKeyStatus.className = 'status ok'
      apiKeyStatus.textContent = '✓ API key saved and validated.'
    } else {
      apiKeyStatus.className = 'status'
      apiKeyStatus.style.color = '#DC2626'
      apiKeyStatus.textContent = `Validation failed: ${resp?.error || 'Unknown error'}`
    }
  } catch (err) {
    apiKeyStatus.className = 'status'
    apiKeyStatus.style.color = '#DC2626'
    apiKeyStatus.textContent = `Error: ${err.message}`
  } finally {
    saveApiKeyBtn.disabled = false
    saveApiKeyBtn.textContent = 'Save & Validate'
  }
})

// ─── Cache Status ─────────────────────────────────────────────────────────────

async function loadCacheStatus() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_CACHE_STATUS' })
    if (resp.hasCachedData) {
      statusEl.className = 'status ok'
      statusEl.textContent = `✓ ${resp.count.toLocaleString()} breaches cached · ${resp.ageDays === 0 ? 'Updated today' : `${resp.ageDays} day${resp.ageDays !== 1 ? 's' : ''} ago`}${resp.isStale ? ' (stale — will refresh on next popup open)' : ''}`
    } else {
      statusEl.className = 'status'
      statusEl.textContent = 'No cached data yet. Click "Refresh now" to fetch breach data.'
    }
  } catch (_) {
    statusEl.textContent = 'Unable to check cache status.'
  }
}

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true
  refreshBtn.textContent = 'Refreshing…'
  statusEl.className = 'status'
  statusEl.textContent = 'Fetching from Have I Been Pwned…'
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'REFRESH_BREACH_CACHE' })
    if (resp.success) {
      statusEl.className = 'status ok'
      statusEl.textContent = `✓ Refreshed — ${resp.count.toLocaleString()} breaches cached.`
    } else {
      statusEl.textContent = `Error: ${resp.error}`
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`
  } finally {
    refreshBtn.disabled = false
    refreshBtn.textContent = 'Refresh now'
  }
})

loadCacheStatus()
