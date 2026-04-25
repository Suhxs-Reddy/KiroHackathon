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
