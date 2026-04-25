/**
 * background.js — DataGuard service worker
 * Handles HIBP breach data: fetch, cache (weekly), and query.
 * Also routes messages between popup and content script.
 */

'use strict'

const HIBP_URL = 'https://haveibeenpwned.com/api/v3/breaches'
const CACHE_KEY = 'hibp_breaches_cache'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 1 week

// ─── HIBP cache management ────────────────────────────────────────────────────

async function getCachedBreaches() {
  return new Promise(resolve => {
    chrome.storage.local.get([CACHE_KEY], result => {
      const cached = result[CACHE_KEY]
      if (cached && cached.timestamp && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
        resolve(cached.data)
      } else {
        resolve(null)
      }
    })
  })
}

async function fetchAndCacheBreaches() {
  try {
    const response = await fetch(HIBP_URL, {
      headers: {
        'User-Agent': 'DataGuard-Extension/0.1.0',
      }
    })
    if (!response.ok) throw new Error(`HIBP API error: ${response.status}`)
    const data = await response.json()
    await new Promise(resolve => {
      chrome.storage.local.set({
        [CACHE_KEY]: { data, timestamp: Date.now() }
      }, resolve)
    })
    return data
  } catch (err) {
    console.warn('[DataGuard] Failed to fetch HIBP data:', err.message)
    return []
  }
}

async function getBreaches() {
  const cached = await getCachedBreaches()
  if (cached) return cached
  return fetchAndCacheBreaches()
}

// ─── Breach query helpers ─────────────────────────────────────────────────────

/**
 * Map our internal category IDs to HIBP DataClasses strings.
 */
const CATEGORY_TO_DATA_CLASSES = {
  FINANCIAL:     ['Credit cards', 'Banking', 'Financial data', 'Payment histories'],
  GOVERNMENT_ID: ['Government issued IDs', 'Social security numbers', 'Passport numbers', 'Driver\'s licenses'],
  AUTH:          ['Passwords', 'Password hints', 'Security questions and answers', 'Auth tokens'],
  IDENTITY:      ['Names', 'Dates of birth', 'Physical addresses', 'Geographic locations'],
  CONTACT:       ['Email addresses', 'Phone numbers'],
  SENSITIVE:     ['Health data', 'Biometric data', 'Medical records', 'Sexual orientations', 'Ethnicities'],
}

function getBreachesForDomain(allBreaches, domain) {
  const domainLower = domain.toLowerCase().replace(/^www\./, '')
  return allBreaches
    .filter(b => {
      const breachDomain = (b.Domain || '').toLowerCase().replace(/^www\./, '')
      return breachDomain === domainLower || breachDomain.endsWith('.' + domainLower)
    })
    .sort((a, b) => new Date(b.BreachDate) - new Date(a.BreachDate))
}

function getBreachesForCategories(allBreaches, categories) {
  const relevantClasses = new Set()
  for (const cat of categories) {
    const classes = CATEGORY_TO_DATA_CLASSES[cat] || []
    classes.forEach(c => relevantClasses.add(c.toLowerCase()))
  }

  return allBreaches
    .filter(b => {
      const dataClasses = (b.DataClasses || []).map(d => d.toLowerCase())
      return dataClasses.some(dc => [...relevantClasses].some(rc => dc.includes(rc) || rc.includes(dc)))
    })
    .sort((a, b) => new Date(b.BreachDate) - new Date(a.BreachDate))
    .slice(0, 5) // top 5 most recent
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_BREACH_DATA') {
    const { domain, categories } = message
    getBreaches().then(allBreaches => {
      const domainBreaches = getBreachesForDomain(allBreaches, domain)
      const categoryBreaches = getBreachesForCategories(allBreaches, categories || [])
      sendResponse({
        success: true,
        domainBreaches,
        categoryBreaches,
        cacheAge: null, // could expose this for UI
      })
    }).catch(err => {
      sendResponse({ success: false, error: err.message, domainBreaches: [], categoryBreaches: [] })
    })
    return true // async
  }

  if (message.type === 'REFRESH_BREACH_CACHE') {
    fetchAndCacheBreaches().then(data => {
      sendResponse({ success: true, count: data.length })
    }).catch(err => {
      sendResponse({ success: false, error: err.message })
    })
    return true
  }

  if (message.type === 'GET_CACHE_STATUS') {
    chrome.storage.local.get([CACHE_KEY], result => {
      const cached = result[CACHE_KEY]
      if (cached && cached.timestamp) {
        const ageMs = Date.now() - cached.timestamp
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))
        sendResponse({
          hasCachedData: true,
          count: cached.data ? cached.data.length : 0,
          ageDays,
          isStale: ageMs >= CACHE_TTL_MS,
        })
      } else {
        sendResponse({ hasCachedData: false, count: 0, ageDays: null, isStale: true })
      }
    })
    return true
  }
})

// Pre-warm the cache on install/startup
chrome.runtime.onInstalled.addListener(() => {
  getBreaches()
})

// ─── Breach watch: check bookmarked sites on cache refresh ───────────────────

const BOOKMARKS_KEY = 'dg_bookmarked_sites'
const NOTIFIED_KEY  = 'dg_notified_breaches'

async function checkBookmarkedSitesForBreaches(allBreaches) {
  const [bookmarksResult, notifiedResult] = await Promise.all([
    new Promise(r => chrome.storage.local.get([BOOKMARKS_KEY], r)),
    new Promise(r => chrome.storage.local.get([NOTIFIED_KEY], r)),
  ])

  const bookmarks = bookmarksResult[BOOKMARKS_KEY] || {}
  const notified  = notifiedResult[NOTIFIED_KEY]   || {}
  const domains   = Object.keys(bookmarks)
  if (domains.length === 0) return

  const fiveYearsAgo = new Date()
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)

  for (const domain of domains) {
    const matches = getBreachesForDomain(allBreaches, domain)
      .filter(b => new Date(b.BreachDate) >= fiveYearsAgo)

    if (matches.length === 0) continue

    // Only notify about breaches we haven't already notified for
    const newBreaches = matches.filter(b => !notified[`${domain}:${b.Name}`])
    if (newBreaches.length === 0) continue

    const latest = newBreaches[0]
    const dataClasses = (latest.DataClasses || []).slice(0, 3).join(', ')

    chrome.notifications.create(`breach-${domain}-${latest.Name}`, {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: `🛡 DataGuard — Breach detected on ${domain}`,
      message: `${latest.Name} (${latest.BreachDate.slice(0, 4)}): ${dataClasses || 'data exposed'}.`,
      priority: 2,
    })

    // Mark as notified
    for (const b of newBreaches) {
      notified[`${domain}:${b.Name}`] = true
    }

    // Update lastChecked on bookmark
    bookmarks[domain].lastChecked = new Date().toISOString()
  }

  await Promise.all([
    new Promise(r => chrome.storage.local.set({ [NOTIFIED_KEY]: notified }, r)),
    new Promise(r => chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks }, r)),
  ])
}

// Run breach watch whenever cache is refreshed
async function fetchAndCacheBreachesWithWatch() {
  const data = await fetchAndCacheBreaches()
  if (data.length > 0) {
    checkBookmarkedSitesForBreaches(data).catch(console.warn)
  }
  return data
}

// Weekly alarm for breach watch
chrome.alarms.create('weekly-breach-check', { periodInMinutes: 60 * 24 * 7 })
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'weekly-breach-check') {
    fetchAndCacheBreachesWithWatch()
  }
})
