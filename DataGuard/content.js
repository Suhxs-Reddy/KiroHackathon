/**
 * content.js — DataGuard content script
 * Runs at document_idle on every page.
 * Scans the DOM for data fields, trackers, and page metadata.
 * NEVER reads field values — only inspects attributes and structure.
 */

'use strict'

// ─── Category definitions (duplicated here to avoid module imports in content scripts) ──

const CATEGORIES = {
  FINANCIAL:     { id: 'financial',     label: 'Financial',      icon: '💳', sensitivity: 5 },
  GOVERNMENT_ID: { id: 'government_id', label: 'Government ID',  icon: '🪪', sensitivity: 5 },
  AUTH:          { id: 'auth',          label: 'Authentication', icon: '🔐', sensitivity: 4 },
  IDENTITY:      { id: 'identity',      label: 'Identity',       icon: '👤', sensitivity: 3 },
  CONTACT:       { id: 'contact',       label: 'Contact',        icon: '📬', sensitivity: 2 },
  SENSITIVE:     { id: 'sensitive',     label: 'Sensitive',      icon: '⚕️', sensitivity: 5 },
}

const RULES = [
  {
    category: 'FINANCIAL',
    typeMatch: [],
    autocompleteMatch: ['cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-name', 'cc-type'],
    nameRegex: /card|credit|debit|cvv|cvc|ccv|expir|billing/i,
    labelRegex: /card\s*number|credit\s*card|debit\s*card|cvv|cvc|expir/i,
  },
  {
    category: 'GOVERNMENT_ID',
    typeMatch: [],
    autocompleteMatch: [],
    nameRegex: /ssn|social.?sec|passport|driver.?lic|national.?id|tax.?id|ein|itin/i,
    labelRegex: /social\s*security|ssn|passport|driver.?s\s*licen|national\s*id|tax\s*id/i,
  },
  {
    category: 'AUTH',
    typeMatch: ['password'],
    autocompleteMatch: ['current-password', 'new-password', 'one-time-code'],
    nameRegex: /password|passwd|secret|pin|otp|mfa|2fa|security.?answer/i,
    labelRegex: /password|secret|pin|one.?time|security\s*question/i,
  },
  {
    category: 'IDENTITY',
    typeMatch: ['date'],
    autocompleteMatch: ['name', 'given-name', 'family-name', 'additional-name', 'honorific-prefix',
                        'honorific-suffix', 'nickname', 'bday', 'bday-day', 'bday-month', 'bday-year',
                        'sex', 'street-address', 'address-line1', 'address-line2', 'address-level1',
                        'address-level2', 'postal-code', 'country', 'country-name'],
    nameRegex: /\bname\b|first.?name|last.?name|full.?name|dob|birth|address|zip|postal|city|state|country/i,
    labelRegex: /\bname\b|date\s*of\s*birth|birthday|address|zip\s*code|postal\s*code/i,
  },
  {
    category: 'CONTACT',
    typeMatch: ['email', 'tel'],
    autocompleteMatch: ['email', 'tel', 'tel-national', 'tel-area-code', 'tel-local', 'tel-extension'],
    nameRegex: /email|e.?mail|phone|mobile|cell|fax|contact/i,
    labelRegex: /email|phone|mobile|telephone|contact/i,
  },
  {
    category: 'SENSITIVE',
    typeMatch: [],
    autocompleteMatch: [],
    nameRegex: /health|medical|diagnosis|insurance|biometric|race|ethnicity|religion|political|sexual/i,
    labelRegex: /health|medical|insurance|biometric|race|ethnicity|religion|political|sexual/i,
  },
]

const SKIP_TYPES = new Set(['submit', 'button', 'reset', 'image', 'hidden', 'file', 'range', 'color', 'checkbox', 'radio'])

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLabelText(el) {
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label')
  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy)
    if (labelEl) return labelEl.textContent || ''
  }
  if (el.id) {
    try {
      const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
      if (labelEl) return labelEl.textContent || ''
    } catch (_) {}
  }
  const parentLabel = el.closest('label')
  if (parentLabel) return parentLabel.textContent || ''
  const prev = el.previousElementSibling
  if (prev && ['LABEL', 'SPAN', 'P', 'DIV'].includes(prev.tagName)) {
    return prev.textContent || ''
  }
  return ''
}

function classifyField(el) {
  const type = (el.getAttribute('type') || el.tagName).toLowerCase()
  if (SKIP_TYPES.has(type)) return null

  const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase()
  const name = (el.getAttribute('name') || el.getAttribute('id') || '').toLowerCase()
  const labelText = getLabelText(el)

  for (const rule of RULES) {
    if (rule.typeMatch.includes(type)) return rule.category
    if (rule.autocompleteMatch.some(ac => autocomplete.includes(ac))) return rule.category
    if (rule.nameRegex.test(name)) return rule.category
    if (rule.labelRegex.test(labelText)) return rule.category
  }
  return null
}

// ─── Page type heuristic ──────────────────────────────────────────────────────

function detectPageType() {
  const url = window.location.href.toLowerCase()
  const title = document.title.toLowerCase()
  const bodyText = document.body ? document.body.innerText.slice(0, 2000).toLowerCase() : ''

  if (/login|sign.?in|log.?in/.test(url + title)) return 'login'
  if (/sign.?up|register|create.?account/.test(url + title)) return 'signup'
  if (/checkout|payment|billing|order/.test(url + title)) return 'checkout'
  if (/account|settings|profile|preferences/.test(url + title)) return 'account_settings'
  return 'generic'
}

// ─── Privacy policy link ──────────────────────────────────────────────────────

function findPrivacyPolicyUrl() {
  const links = document.querySelectorAll('a[href]')
  for (const link of links) {
    const text = (link.textContent || '').toLowerCase()
    const href = link.getAttribute('href') || ''
    if (/privacy\s*policy|privacy\s*notice|data\s*policy/.test(text) ||
        /privacy/.test(href)) {
      try {
        return new URL(href, window.location.href).href
      } catch (_) {
        return href
      }
    }
  }
  return null
}

// ─── Tracker detection ────────────────────────────────────────────────────────

const KNOWN_TRACKERS = [
  { pattern: /google-analytics\.com/i,   name: 'Google Analytics',   category: 'analytics' },
  { pattern: /googletagmanager\.com/i,   name: 'Google Tag Manager', category: 'analytics' },
  { pattern: /doubleclick\.net/i,        name: 'Google DoubleClick', category: 'advertising' },
  { pattern: /connect\.facebook\.net/i,  name: 'Meta Pixel',         category: 'advertising' },
  { pattern: /analytics\.tiktok\.com/i,  name: 'TikTok Pixel',       category: 'advertising' },
  { pattern: /static\.hotjar\.com/i,     name: 'Hotjar',             category: 'session_recording' },
  { pattern: /cdn\.segment\.com/i,       name: 'Segment',            category: 'analytics' },
  { pattern: /cdn\.amplitude\.com/i,     name: 'Amplitude',          category: 'analytics' },
  { pattern: /api\.mixpanel\.com/i,      name: 'Mixpanel',           category: 'analytics' },
  { pattern: /clarity\.ms/i,            name: 'Microsoft Clarity',  category: 'session_recording' },
  { pattern: /snap\.licdn\.com/i,        name: 'LinkedIn Insight',   category: 'advertising' },
  { pattern: /fullstory\.com/i,          name: 'FullStory',          category: 'session_recording' },
  { pattern: /logrocket\.com/i,          name: 'LogRocket',          category: 'session_recording' },
  { pattern: /intercom\.io/i,            name: 'Intercom',           category: 'crm' },
]

function detectTrackers() {
  const scripts = document.querySelectorAll('script[src]')
  const found = new Map()
  for (const script of scripts) {
    const src = script.getAttribute('src') || ''
    for (const tracker of KNOWN_TRACKERS) {
      if (tracker.pattern.test(src) && !found.has(tracker.name)) {
        found.set(tracker.name, tracker)
      }
    }
  }
  return [...found.values()]
}

// ─── Company name ─────────────────────────────────────────────────────────────

function getCompanyName() {
  const ogSiteName = document.querySelector('meta[property="og:site_name"]')
  if (ogSiteName) return ogSiteName.getAttribute('content') || ''
  const appName = document.querySelector('meta[name="application-name"]')
  if (appName) return appName.getAttribute('content') || ''
  return ''
}

// ─── Main scan ────────────────────────────────────────────────────────────────

function scanPage() {
  const inputs = document.querySelectorAll('input, textarea, select')
  const categorySet = new Set()
  const fieldDetails = []

  for (const el of inputs) {
    const category = classifyField(el)
    if (!category) continue
    categorySet.add(category)
    const labelText = getLabelText(el).trim().slice(0, 80)
    fieldDetails.push({
      category,
      label: labelText || el.getAttribute('placeholder') || el.getAttribute('name') || 'Unnamed field',
      type: el.getAttribute('type') || el.tagName.toLowerCase(),
    })
  }

  const domain = window.location.hostname.replace(/^www\./, '')
  const companyName = getCompanyName()
  const pageType = detectPageType()
  const policyUrl = findPrivacyPolicyUrl()
  const trackers = detectTrackers()
  const hasHttps = window.location.protocol === 'https:'

  return {
    domain,
    companyName,
    pageType,
    categories: [...categorySet],
    fieldDetails,
    trackers,
    policyUrl,
    hasHttps,
    url: window.location.href,
    title: document.title,
  }
}

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_PAGE_DATA') {
    try {
      sendResponse({ success: true, data: scanPage() })
    } catch (err) {
      sendResponse({ success: false, error: err.message })
    }
  }
  return true // keep channel open for async
})


// ─── Auto-detect terms/privacy links and show DataGuard dashboard ─────────────

let _dataguardAutoTriggered = false

function findPolicyUrl() {
  const allLinks = document.querySelectorAll('a[href]')
  for (const link of allLinks) {
    const text = (link.textContent || '').toLowerCase()
    const href = (link.getAttribute('href') || '').toLowerCase()
    if (/privacy\s*policy|privacy\s*notice|data\s*policy|terms\s*of\s*service|terms\s*of\s*use/i.test(text) ||
        /\/privacy|\/terms|\/tos|\/legal/i.test(href)) {
      try {
        return new URL(link.getAttribute('href'), window.location.href).href
      } catch (_) {}
    }
  }
  return null
}

function openDashboardIframe() {
  const existing = document.querySelector('.dataguard-dashboard-frame')
  if (existing) { existing.remove(); return }

  if (!document.querySelector('#dataguard-anim-style')) {
    const style = document.createElement('style')
    style.id = 'dataguard-anim-style'
    style.textContent = `@keyframes dataguardSlideIn { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }`
    document.head.appendChild(style)
  }

  const container = document.createElement('div')
  container.className = 'dataguard-dashboard-frame'
  container.style.cssText = `
    position: fixed; top: 10px; right: 10px; width: 370px; height: 560px;
    z-index: 2147483647; border: none; border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.2); overflow: hidden;
    animation: dataguardSlideIn 0.25s ease-out;
  `

  const closeBtn = document.createElement('button')
  closeBtn.textContent = '×'
  closeBtn.style.cssText = `
    position: absolute; top: 6px; right: 10px; z-index: 2147483648;
    background: rgba(255,255,255,0.9); border: 1px solid #E5E7EB; border-radius: 50%;
    width: 24px; height: 24px; font-size: 16px; line-height: 1; cursor: pointer;
    color: #6B7280; display: flex; align-items: center; justify-content: center;
  `
  closeBtn.addEventListener('click', () => container.remove())

  const iframe = document.createElement('iframe')
  iframe.src = chrome.runtime.getURL('DataGuard/popup.html')
  iframe.style.cssText = 'width: 100%; height: 100%; border: none; border-radius: 14px;'

  container.appendChild(closeBtn)
  container.appendChild(iframe)
  document.body.appendChild(container)
}

function autoDetectAndAnalyze() {
  if (_dataguardAutoTriggered) return

  // Check if page has "agree to terms" text
  const bodyText = document.body ? document.body.innerText.slice(0, 5000) : ''
  const hasAgreement = /agree\s*(to|with)\s*(the|our)?\s*(terms|privacy|policy)/i.test(bodyText) ||
                       /by\s*(creating|signing|registering|continuing).*agree/i.test(bodyText) ||
                       /i\s*(accept|agree|consent)\s*(to|the)/i.test(bodyText)

  if (!hasAgreement) return

  // Find a privacy/terms link on the page
  const policyUrl = findPolicyUrl()
  if (!policyUrl) return

  _dataguardAutoTriggered = true

  // Store the domain so popup auto-renders
  const domain = window.location.hostname.replace(/^www\./, '')
  chrome.storage.local.set({ '_dataguard_auto_render': domain })

  // Fire the analysis
  chrome.runtime.sendMessage(
    { type: 'INITIATE_ANALYSIS', payload: { policyUrl } },
    () => {}
  )

  // Open the dashboard immediately
  openDashboardIframe()
}

// Run after page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(autoDetectAndAnalyze, 1000))
} else {
  setTimeout(autoDetectAndAnalyze, 1000)
}

// Watch for dynamic content (SPAs)
const _dgObserver = new MutationObserver(() => { autoDetectAndAnalyze() })
_dgObserver.observe(document.body || document.documentElement, { childList: true, subtree: true })
