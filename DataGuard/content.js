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


// ─── Auto-detect "agree to terms" checkboxes and inject risk badge ────────────

const AGREE_PATTERNS = [
  /agree\s*(to|with)\s*(the|our)?\s*(terms|privacy|policy|tos)/i,
  /by\s*(creating|signing|registering|continuing)/i,
  /i\s*(accept|agree|consent)/i,
  /you\s*agree\s*to/i,
]

let _dataguardBadgeInjected = false

function findTermsAgreementElements() {
  if (_dataguardBadgeInjected) return []
  const results = []
  const candidates = document.querySelectorAll('label, p, span, div')
  for (const el of candidates) {
    const text = (el.textContent || '').trim()
    if (text.length < 10 || text.length > 500) continue
    if (!AGREE_PATTERNS.some(p => p.test(text))) continue
    // Skip if this element is inside another match
    if (el.closest('.dataguard-inline-badge') || el.closest('.dataguard-dashboard')) continue

    const links = el.querySelectorAll('a[href]')
    const policyLinks = []
    for (const link of links) {
      const linkText = (link.textContent || '').toLowerCase()
      const href = link.getAttribute('href') || ''
      if (/privacy|terms|policy|tos|data/i.test(linkText + ' ' + href)) {
        try {
          policyLinks.push({ url: new URL(href, window.location.href).href, text: link.textContent.trim() })
        } catch (_) {}
      }
    }
    if (policyLinks.length > 0) {
      results.push({ element: el, policyLinks })
      break // Only take the FIRST match
    }
  }
  return results
}

function buildDashboardHtml(analysis) {
  const risk = analysis.overallRiskLevel || 'medium'
  const riskColors = { high: '#DC2626', medium: '#D97706', low: '#059669' }
  const riskBgs = { high: '#FEF2F2', medium: '#FFFBEB', low: '#ECFDF5' }
  const rc = riskColors[risk] || riskColors.medium

  let html = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <div style="font-weight:700;font-size:14px;color:#1F2937;">DataGuard Analysis</div>
      <div style="display:flex;align-items:center;gap:4px;padding:3px 10px;border-radius:8px;background:${riskBgs[risk]};color:${rc};font-size:11px;font-weight:700;letter-spacing:0.03em;">${risk.toUpperCase()} RISK</div>
      <button class="dataguard-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9CA3AF;padding:0;line-height:1;">&times;</button>
    </div>
  `

  // Key takeaways
  if (analysis.policySummary && analysis.policySummary.length > 0) {
    html += `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-left:3px solid #F59E0B;border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:11px;color:#92400E;line-height:1.5;">
      <div style="font-weight:600;margin-bottom:4px;">Key Takeaways</div>
      <ul style="margin:0;padding-left:14px;list-style:disc;">${analysis.policySummary.map(p => `<li style="margin-bottom:2px;">${p}</li>`).join('')}</ul>
    </div>`
  }

  // Data types
  if (analysis.dataTypes && analysis.dataTypes.length > 0) {
    html += `<div style="max-height:200px;overflow-y:auto;">`
    for (const dt of analysis.dataTypes) {
      const dtc = riskColors[dt.riskLevel] || '#6B7280'
      const dtbg = riskBgs[dt.riskLevel] || '#F9FAFB'
      html += `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-left:3px solid ${dtc};border-radius:6px;padding:8px 10px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-weight:600;font-size:12px;color:#1F2937;">${dt.dataType}</span>
          <span style="font-size:9px;font-weight:700;text-transform:uppercase;padding:1px 6px;border-radius:10px;background:${dtbg};color:${dtc};">${dt.riskLevel}</span>
        </div>
        ${dt.purposes && dt.purposes.length > 0 ? `<div style="font-size:10px;color:#6B7280;margin-top:2px;">${dt.purposes.slice(0,2).join(', ')}</div>` : ''}
        ${dt.sharedWithThirdParties ? `<div style="font-size:10px;color:#DC2626;margin-top:2px;">Shared with third parties</div>` : ''}
        ${dt.optOutGuidance && dt.optOutGuidance.status === 'available' ? `<div style="font-size:10px;color:#059669;margin-top:2px;">Opt-out available</div>` : ''}
        ${dt.optOutGuidance && dt.optOutGuidance.status === 'unavailable' ? `<div style="font-size:10px;color:#9CA3AF;margin-top:2px;">No opt-out found</div>` : ''}
      </div>`
    }
    html += `</div>`
  }

  html += `<div style="font-size:9px;color:#9CA3AF;margin-top:6px;">Model: ${analysis.modelUsed || 'AI'}</div>`
  return html
}

function injectRiskBadge(element, policyLinks) {
  if (_dataguardBadgeInjected) return
  if (element.querySelector('.dataguard-inline-badge')) return
  _dataguardBadgeInjected = true

  const badge = document.createElement('div')
  badge.className = 'dataguard-inline-badge'
  badge.style.cssText = `
    display: inline-flex; align-items: center; gap: 6px; margin-top: 8px;
    padding: 6px 12px; background: #EFF6FF; border: 1px solid #93C5FD;
    border-radius: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 12px; color: #1D4ED8; cursor: pointer; transition: all 0.2s ease;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  `
  const shieldSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`
  badge.innerHTML = `${shieldSvg} <span class="dataguard-badge-text">Scanning terms...</span>`

  badge.addEventListener('mouseenter', () => { badge.style.transform = 'translateY(-1px)'; badge.style.boxShadow = '0 3px 8px rgba(37,99,235,0.2)' })
  badge.addEventListener('mouseleave', () => { badge.style.transform = 'translateY(0)'; badge.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)' })

  element.appendChild(badge)

  const targetUrl = policyLinks[0].url
  chrome.runtime.sendMessage(
    { type: 'INITIATE_ANALYSIS', payload: { policyUrl: targetUrl } },
    (response) => {
      const textEl = badge.querySelector('.dataguard-badge-text')
      if (!textEl) return

      if (response && response.success && response.analysis) {
        const risk = response.analysis.overallRiskLevel
        const count = response.analysis.dataTypes ? response.analysis.dataTypes.length : 0
        const colors = {
          high: { bg: '#FEF2F2', border: '#FCA5A5', text: '#DC2626' },
          medium: { bg: '#FFFBEB', border: '#FDE68A', text: '#D97706' },
          low: { bg: '#ECFDF5', border: '#A7F3D0', text: '#059669' },
        }
        const c = colors[risk] || colors.medium
        badge.style.background = c.bg
        badge.style.borderColor = c.border
        badge.style.color = c.text
        textEl.textContent = `${risk.toUpperCase()} RISK · ${count} data types — Click for details`

        // Click opens inline dashboard on THIS page
        badge.addEventListener('click', (e) => {
          e.stopPropagation()
          // Remove existing dashboard if any
          const existing = document.querySelector('.dataguard-dashboard')
          if (existing) { existing.remove(); return }

          const dashboard = document.createElement('div')
          dashboard.className = 'dataguard-dashboard'
          dashboard.style.cssText = `
            position: fixed; top: 20px; right: 20px; width: 340px; max-height: 500px;
            overflow-y: auto; background: #fff; border: 2px solid #2563EB;
            border-radius: 12px; padding: 16px; box-shadow: 0 8px 30px rgba(0,0,0,0.15);
            z-index: 2147483647; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px; color: #1F2937; animation: dataguardSlideIn 0.25s ease-out;
          `
          // Add animation keyframes
          if (!document.querySelector('#dataguard-anim-style')) {
            const style = document.createElement('style')
            style.id = 'dataguard-anim-style'
            style.textContent = `
              @keyframes dataguardSlideIn { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }
              .dataguard-dashboard::-webkit-scrollbar { width: 4px; }
              .dataguard-dashboard::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 2px; }
            `
            document.head.appendChild(style)
          }

          dashboard.innerHTML = buildDashboardHtml(response.analysis)
          document.body.appendChild(dashboard)

          // Close button
          dashboard.querySelector('.dataguard-close').addEventListener('click', () => dashboard.remove())
        })
      } else {
        textEl.textContent = 'Could not analyze terms'
        badge.style.background = '#F9FAFB'
        badge.style.borderColor = '#E5E7EB'
        badge.style.color = '#6B7280'
      }
    }
  )
}

function detectAndInjectBadges() {
  const agreements = findTermsAgreementElements()
  for (const { element, policyLinks } of agreements) {
    injectRiskBadge(element, policyLinks)
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', detectAndInjectBadges)
} else {
  detectAndInjectBadges()
}

const _dgObserver = new MutationObserver(() => { detectAndInjectBadges() })
_dgObserver.observe(document.body || document.documentElement, { childList: true, subtree: true })
