/**
 * popup.js — DataGuard popup
 * Orchestrates: page data from content script → breach data from background → render UI.
 */

'use strict'

// ─── Category metadata ────────────────────────────────────────────────────────

const CATEGORY_META = {
  FINANCIAL:     { label: 'Financial',      icon: '', cssClass: 'financial',
    description: 'This site collects financial information such as credit/debit card numbers, CVV codes, or billing details. This is among the most sensitive data you can share online.',
    usedFor: 'Used for payment processing. Exposed in breaches, this data enables fraud and identity theft.' },
  GOVERNMENT_ID: { label: 'Government ID',  icon: '', cssClass: 'government_id',
    description: 'This site collects government-issued identification such as Social Security Numbers, passport numbers, or driver\'s license numbers.',
    usedFor: 'Used for identity verification. Extremely sensitive — exposure enables identity theft.' },
  AUTH:          { label: 'Authentication', icon: '', cssClass: 'auth',
    description: 'This site collects authentication credentials such as passwords, PINs, or security question answers.',
    usedFor: 'Used to verify your identity. Exposed passwords can compromise all accounts where you reuse them.' },
  IDENTITY:      { label: 'Identity',       icon: '', cssClass: 'identity',
    description: 'This site collects personal identity information such as your full name, date of birth, or home address.',
    usedFor: 'Used for account creation and verification. Can be combined with other data for identity theft.' },
  CONTACT:       { label: 'Contact',        icon: '', cssClass: 'contact',
    description: 'This site collects contact information such as your email address or phone number.',
    usedFor: 'Used for communication and account recovery. Often sold to data brokers or used for spam.' },
  SENSITIVE:     { label: 'Sensitive',      icon: '', cssClass: 'sensitive',
    description: 'This site collects sensitive personal data such as health information, biometric data, or demographic details.',
    usedFor: 'Highly sensitive — can affect insurance, employment, and personal safety if exposed.' },
}

// ─── Risk metadata ────────────────────────────────────────────────────────────

const RISK_META = {
  high:   { label: 'HIGH RISK',   icon: '', cssClass: 'high' },
  medium: { label: 'MEDIUM RISK', icon: '', cssClass: 'medium' },
  low:    { label: 'LOW RISK',    icon: '', cssClass: 'low' },
}

// ─── Risk scorer (inline — avoids ES module issues in MV3 popup) ──────────────

const HIGH_SENSITIVITY_CATS = new Set(['FINANCIAL', 'GOVERNMENT_ID', 'SENSITIVE', 'AUTH'])
const SENSITIVITY = { FINANCIAL: 5, GOVERNMENT_ID: 5, SENSITIVE: 5, AUTH: 4, IDENTITY: 3, CONTACT: 2 }

function computeRisk({ categories, breaches, hasHttps, policyUrl }) {
  const reasons = []
  let score = 0

  if (categories.length === 0) {
    return { level: 'low', reasons: ['No data input fields detected on this page.'], score: 0 }
  }

  const maxSensitivity = Math.max(...categories.map(c => SENSITIVITY[c] ?? 1))
  score += maxSensitivity * 10

  const hasHighSensitivity = categories.some(c => HIGH_SENSITIVITY_CATS.has(c))

  if (categories.includes('FINANCIAL'))     reasons.push('This page collects financial information (card number, CVV, or billing details).')
  if (categories.includes('GOVERNMENT_ID')) reasons.push('This page collects government-issued ID information (SSN, passport, driver\'s license).')
  if (categories.includes('AUTH'))          reasons.push('This page collects authentication credentials (password or security questions).')
  if (categories.includes('SENSITIVE'))     reasons.push('This page collects sensitive personal data (health, biometric, or demographic information).')
  if (categories.includes('IDENTITY'))      reasons.push('This page collects identity information (name, date of birth, or address).')
  if (categories.includes('CONTACT'))       reasons.push('This page collects contact information (email or phone number).')

  if (!hasHttps) {
    score += 30
    reasons.push('This page does not use HTTPS — data is transmitted unencrypted.')
  }

  if (!policyUrl) {
    score += 10
    reasons.push('No privacy policy link was found on this page.')
  }

  const fiveYearsAgo = new Date()
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)
  const recentBreaches = (breaches || []).filter(b => new Date(b.BreachDate) >= fiveYearsAgo)

  if (recentBreaches.length > 0) {
    score += recentBreaches.length * 15
    const latest = recentBreaches[0]
    reasons.push(
      `This domain had ${recentBreaches.length} confirmed breach${recentBreaches.length > 1 ? 'es' : ''} in the last 5 years` +
      (latest ? ` (most recent: ${latest.Name}, ${latest.BreachDate.slice(0, 4)})` : '') + '.'
    )
  }

  let level
  if (score >= 50 || (hasHighSensitivity && recentBreaches.length > 0) || !hasHttps) {
    level = 'high'
  } else if (score >= 20 || hasHighSensitivity || categories.length >= 2) {
    level = 'medium'
  } else {
    level = 'low'
  }

  return { level, reasons, score }
}

// ─── Opt-out database (loaded from JSON) ──────────────────────────────────────

let optOutDb = []

async function loadOptOutDb() {
  try {
    const resp = await fetch(chrome.runtime.getURL('data/opt_out_database.json'))
    optOutDb = await resp.json()
  } catch (_) {
    optOutDb = []
  }
}

function findOptOut(domain) {
  const d = domain.toLowerCase().replace(/^www\./, '')
  return optOutDb.find(entry => {
    const ed = entry.domain.toLowerCase().replace(/^www\./, '')
    return ed === d || d.endsWith('.' + ed)
  }) || null
}

// ─── Privacy label categories (Apple App Store-style) ─────────────────────

const PRIVACY_CATEGORIES = {
  'health': { label: 'Health', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' },
  'financial': { label: 'Financial', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>' },
  'location': { label: 'Location', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' },
  'contact': { label: 'Contact Info', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>' },
  'browsing': { label: 'Browsing', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>' },
  'identifiers': { label: 'Identifiers', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' },
  'sensitive': { label: 'Sensitive', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' },
  'usage': { label: 'Usage Data', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>' },
}

function mapDataTypeToCategory(dataType) {
  const dt = dataType.toLowerCase()
  if (dt.includes('health') || dt.includes('medical')) return 'health'
  if (dt.includes('financial') || dt.includes('payment') || dt.includes('transaction')) return 'financial'
  if (dt.includes('location') || dt.includes('gps') || dt.includes('geolocation')) return 'location'
  if (dt.includes('email') || dt.includes('phone') || dt.includes('contact')) return 'contact'
  if (dt.includes('browsing') || dt.includes('search') || dt.includes('history')) return 'browsing'
  if (dt.includes('identifier') || dt.includes('device') || dt.includes('ip address') || dt.includes('biometric') || dt.includes('government')) return 'identifiers'
  if (dt.includes('sensitive') || dt.includes('biometric')) return 'sensitive'
  if (dt.includes('usage') || dt.includes('diagnostic') || dt.includes('interest') || dt.includes('inferred')) return 'usage'
  return 'usage' // default
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function el(id) { return document.getElementById(id) }

function show(id) { el(id).classList.remove('hidden') }
function hide(id) { el(id).classList.add('hidden') }

function formatNumber(n) {
  if (!n) return 'Unknown'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toString()
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch (_) { return dateStr }
}

// ─── Render functions ─────────────────────────────────────────────────────────

function renderHeader(pageData) {
  el('domain-name').textContent = pageData.domain
  if (pageData.companyName && pageData.companyName !== pageData.domain) {
    el('company-name').textContent = pageData.companyName
  }
  const favicon = el('favicon')
  favicon.src = `https://www.google.com/s2/favicons?domain=${pageData.domain}&sz=32`
  favicon.onerror = () => { favicon.style.display = 'none' }
}

function renderRiskBadge(level) {
  const meta = RISK_META[level] || RISK_META.low
  const badge = el('risk-badge')
  badge.className = `risk-badge ${meta.cssClass}`
  el('risk-icon').innerHTML = `<span class="status-dot ${meta.cssClass === 'high' ? 'unavailable' : meta.cssClass === 'medium' ? 'warning' : 'available'}" style="width:8px;height:8px;"></span>`
  el('risk-label').textContent = meta.label
}

// ─── Data usage color system ──────────────────────────────────────────────────

const DATA_USAGE_META = {
  collected: { label: 'Collected',  cssClass: 'usage-collected', dot: '<span class="status-dot available"></span>' },
  shared:    { label: 'Shared',     cssClass: 'usage-shared',    dot: '<span class="status-dot warning"></span>' },
  sold:      { label: 'Sold',       cssClass: 'usage-sold',      dot: '<span class="status-dot unavailable"></span>' },
  unknown:   { label: 'Unknown',    cssClass: 'usage-unknown',   dot: '<span class="status-dot" style="background:var(--text-muted)"></span>' },
}

function renderCategories(categories, fieldDetails, dataUsage) {
  const pillsContainer = el('category-pills')
  pillsContainer.innerHTML = ''

  if (categories.length === 0) {
    show('no-fields')
    return
  }

  hide('no-fields')

  // Legend
  const legend = document.createElement('div')
  legend.className = 'usage-legend'
  legend.innerHTML = `
    <span class="legend-title">Data usage on this site:</span>
    <span class="legend-item usage-collected"><span class="status-dot available"></span> Collected</span>
    <span class="legend-item usage-shared"><span class="status-dot warning"></span> Shared</span>
    <span class="legend-item usage-sold"><span class="status-dot unavailable"></span> Sold</span>
  `
  pillsContainer.appendChild(legend)

  // Usage badge below legend
  const usageMeta = DATA_USAGE_META[dataUsage] || DATA_USAGE_META.unknown
  const usageBanner = document.createElement('div')
  usageBanner.className = `usage-banner ${usageMeta.cssClass}`
  usageBanner.innerHTML = `${usageMeta.dot} This site <strong>${usageMeta.label === 'Unknown' ? 'has unknown data practices' : usageMeta.label === 'Collected' ? 'only collects your data internally' : usageMeta.label === 'Shared' ? 'shares your data with third parties' : 'sells your data to third parties'}</strong>`
  pillsContainer.appendChild(usageBanner)

  for (const catId of categories) {
    const meta = CATEGORY_META[catId]
    if (!meta) continue

    // Pill label — colored by data_usage
    const pill = document.createElement('div')
    pill.className = `pill ${usageMeta.cssClass}-pill`
    pill.innerHTML = `<span>${meta.label}</span>`
    pillsContainer.appendChild(pill)

    // Always-visible detail card
    const card = document.createElement('div')
    card.className = `field-detail-inline ${usageMeta.cssClass}-card`

    const fields = fieldDetails.filter(f => f.category === catId)
    const fieldsHtml = fields.length === 0
      ? `<li><span class="field-type-badge">—</span><span>Fields detected (labels not available)</span></li>`
      : fields.map(f =>
          `<li><span class="field-type-badge">${f.type}</span><span>${f.label}</span></li>`
        ).join('')

    card.innerHTML = `
      <p class="field-detail-desc">${meta.usedFor}</p>
      <ul class="field-list">${fieldsHtml}</ul>
    `
    pillsContainer.appendChild(card)
  }
}

function renderReasons(reasons) {
  const list = el('reason-list')
  list.innerHTML = ''
  for (const reason of reasons) {
    const li = document.createElement('li')
    li.textContent = reason
    list.appendChild(li)
  }
}

function renderBreachItem(breach) {
  const div = document.createElement('div')
  div.className = 'breach-item'

  const classes = (breach.DataClasses || []).slice(0, 5)
  const classesHtml = classes.map(c => `<span class="breach-class-tag">${c}</span>`).join('')

  div.innerHTML = `
    <div class="breach-item-header">
      <span class="breach-name">${breach.Name || breach.Domain || 'Unknown'}</span>
      <span class="breach-date">${formatDate(breach.BreachDate)}</span>
    </div>
    <div class="breach-accounts">
      ${breach.PwnCount ? `${formatNumber(breach.PwnCount)} accounts affected` : ''}
    </div>
    <div class="breach-classes">${classesHtml}</div>
  `
  return div
}

function renderBreaches(domainBreaches, categoryBreaches) {
  // Domain tab
  const domainList = el('domain-breach-list')
  domainList.innerHTML = ''
  if (domainBreaches.length === 0) {
    domainList.innerHTML = `
      <p class="no-breach-msg">No known breaches in our database</p>
      <p class="no-breach-caveat">Absence of a record doesn't guarantee this site has never been breached.</p>
    `
  } else {
    domainBreaches.slice(0, 5).forEach(b => domainList.appendChild(renderBreachItem(b)))
  }

  // Category tab
  const catList = el('category-breach-list')
  catList.innerHTML = ''
  if (categoryBreaches.length === 0) {
    catList.innerHTML = `<p class="no-breach-msg">No recent breaches found for the detected data types.</p>`
  } else {
    categoryBreaches.slice(0, 5).forEach(b => catList.appendChild(renderBreachItem(b)))
  }

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'))
      btn.classList.add('active')
      show(btn.dataset.tab)
    })
  })
}

function renderOptOut(domain) {
  const container = el('optout-content')
  container.innerHTML = ''
  const entry = findOptOut(domain)

  if (entry) {
    const difficultyClass = entry.difficulty || 'medium'
    const difficultyLabel = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }[difficultyClass] || difficultyClass

    const altItems = (entry.alternatives || []).map(a => {
      // Support both old string format and new {text, url} format
      if (typeof a === 'string') return `<li>${a}</li>`
      return `<li><a href="${a.url}" target="_blank" rel="noopener noreferrer" class="alt-link">${a.text} ↗</a></li>`
    }).join('')

    container.innerHTML = `
      <div class="optout-cta">
        <a href="${entry.opt_out_url}" target="_blank" rel="noopener noreferrer" class="optout-btn">
          Go to opt-out page ↗
        </a>
        <div class="optout-meta">
          <span class="difficulty-badge ${difficultyClass}">${difficultyLabel}</span>
          <span class="optout-time">${entry.estimated_time}</span>
        </div>
        ${entry.notes ? `<p class="optout-notes">${entry.notes}</p>` : ''}
        ${altItems ? `
          <button class="alternatives-toggle" aria-expanded="false">
            <span class="toggle-arrow">▶</span>
            Alternative paths
          </button>
          <ul class="alternatives-list hidden">${altItems}</ul>
        ` : ''}
      </div>
    `

    // Alternatives toggle
    const toggle = container.querySelector('.alternatives-toggle')
    if (toggle) {
      toggle.addEventListener('click', () => {
        const list = container.querySelector('.alternatives-list')
        const arrow = toggle.querySelector('.toggle-arrow')
        const isOpen = !list.classList.contains('hidden')
        list.classList.toggle('hidden', isOpen)
        arrow.classList.toggle('open', !isOpen)
        toggle.setAttribute('aria-expanded', String(!isOpen))
      })
    }
  } else {
    // Generic fallback
    container.innerHTML = `
      <div class="generic-optout">
        <p>No specific opt-out info found for <strong>${domain}</strong>. Try these steps:</p>
        <ol>
          <li>Look for "Privacy", "Account", or "Data" in the site footer.</li>
          <li>Search <em>"${domain} delete account"</em> on Google.</li>
          <li>If you're in the EU or California, email the site requesting data deletion under GDPR/CCPA.</li>
          <li>Block the domain via DNS (NextDNS, Pi-hole) or use a masked email forwarder.</li>
        </ol>
      </div>
    `
  }
}

function renderScanTime() {
  el('scan-time').textContent = `Scanned ${new Date().toLocaleTimeString()}`
}

// ─── Bookmark feature ─────────────────────────────────────────────────────────

const BOOKMARKS_KEY = 'dg_bookmarked_sites'

async function getBookmarks() {
  return new Promise(resolve => {
    chrome.storage.local.get([BOOKMARKS_KEY], result => {
      resolve(result[BOOKMARKS_KEY] || {})
    })
  })
}

async function saveBookmarks(bookmarks) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks }, resolve)
  })
}

async function initBookmarkBtn(domain) {
  const btn = el('bookmark-btn')
  if (!btn) return

  const bookmarks = await getBookmarks()
  const isBookmarked = !!bookmarks[domain]
  updateBookmarkBtn(btn, isBookmarked)

  btn.addEventListener('click', async () => {
    const current = await getBookmarks()
    const nowBookmarked = !!current[domain]

    if (nowBookmarked) {
      delete current[domain]
    } else {
      current[domain] = { addedAt: new Date().toISOString(), lastChecked: null }
    }

    await saveBookmarks(current)
    updateBookmarkBtn(btn, !nowBookmarked)

    // Brief confirmation flash
    const prev = btn.textContent
    btn.textContent = nowBookmarked ? 'Removed' : 'Bookmarked'
    btn.disabled = true
    setTimeout(() => {
      updateBookmarkBtn(btn, !nowBookmarked)
      btn.disabled = false
    }, 1200)
  })
}

function updateBookmarkBtn(btn, isBookmarked) {
  if (isBookmarked) {
    btn.textContent = 'Bookmarked'
    btn.classList.add('bookmarked')
  } else {
    btn.textContent = 'Bookmark'
    btn.classList.remove('bookmarked')
  }
}

// ─── AI Policy Analysis ───────────────────────────────────────────────────

/**
 * Build a mailto: link for opt-out email requests.
 */
function buildMailtoLink(emailAddress, domain, dataType) {
  const subject = `Data Opt-Out Request — ${domain}`
  const body = [
    `Dear ${domain} Privacy Team,`,
    '',
    `I am a user of ${domain} and I am writing to request that you opt me out of ` +
      `the collection and/or sharing of my ${dataType} data.`,
    '',
    'I am making this request pursuant to applicable privacy regulations, including ' +
      'but not limited to the GDPR, CCPA, and other relevant data protection laws.',
    '',
    'Please confirm that my request has been processed and provide a timeline ' +
      'for when the opt-out will take effect.',
    '',
    'Thank you for your prompt attention to this matter.',
    '',
    'Sincerely,',
    '[Your Name]',
  ].join('\n')

  return `mailto:${emailAddress}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/**
 * Build an .ics calendar file for postal mail reminders.
 */
function buildIcsContent(domain, dataType, delayDays) {
  const now = new Date()
  const eventDate = new Date(now.getTime() + delayDays * 24 * 60 * 60 * 1000)

  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

  const title = `Send opt-out letter to ${domain} (${dataType})`
  const description = `Reminder to send your opt-out letter for ${dataType} data to ${domain}. Include your name, address, and a clear statement requesting opt-out.`

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DataGuard//Opt-Out Reminder//EN',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(eventDate)}`,
    `DTEND:${fmt(new Date(eventDate.getTime() + 30 * 60 * 1000))}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${title}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

/**
 * Download an .ics file via Blob URL.
 */
function downloadIcsBlob(icsContent, filename) {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Render a Risk_Analysis object into the policy analysis content area.
 */
function renderPolicyAnalysis(analysis) {
  const container = el('policy-analysis-content')
  container.innerHTML = ''

  // Update the header risk badge with AI analysis risk level
  if (analysis.overallRiskLevel) {
    renderRiskBadge(analysis.overallRiskLevel)
  }

  // Hide the analyze button since we have results
  const btn = el('analyze-policy-btn')
  if (btn) btn.classList.add('hidden')

  // Key Takeaways (collapsible)
  if (analysis.policySummary && analysis.policySummary.length > 0) {
    const summaryBox = document.createElement('div')
    summaryBox.className = 'policy-summary'
    summaryBox.innerHTML = `
      <button class="summary-toggle" aria-expanded="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
        Key Takeaways
      </button>
      <ul class="summary-list">
        ${analysis.policySummary.map(point => `<li>${escapeHtml(point)}</li>`).join('')}
      </ul>
    `
    // Wire up collapsible toggle
    const toggleBtn = summaryBox.querySelector('.summary-toggle')
    const summaryList = summaryBox.querySelector('.summary-list')
    toggleBtn.addEventListener('click', () => {
      const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true'
      toggleBtn.setAttribute('aria-expanded', String(!isExpanded))
      summaryList.classList.toggle('collapsed', isExpanded)
    })
    container.appendChild(summaryBox)
  }

  // Privacy label grid (Apple App Store-style overview)
  if (analysis.dataTypes && analysis.dataTypes.length > 0) {
    const categories = new Map()
    for (const dt of analysis.dataTypes) {
      const cat = mapDataTypeToCategory(dt.dataType)
      if (!categories.has(cat)) {
        categories.set(cat, { count: 0, highRisk: false })
      }
      const entry = categories.get(cat)
      entry.count++
      if (dt.riskLevel === 'high') entry.highRisk = true
    }

    const grid = document.createElement('div')
    grid.className = 'privacy-label-grid'

    for (const [catId, info] of categories) {
      const meta = PRIVACY_CATEGORIES[catId]
      if (!meta) continue
      const tile = document.createElement('div')
      tile.className = `privacy-label-tile ${info.highRisk ? 'high-risk' : ''}`
      tile.innerHTML = `
        <div class="tile-icon">${meta.icon}</div>
        <div class="tile-label">${meta.label}</div>
      `
      grid.appendChild(tile)
    }

    container.appendChild(grid)
  }

  // Data type cards
  if (analysis.dataTypes && analysis.dataTypes.length > 0) {
    for (const dt of analysis.dataTypes) {
      const card = document.createElement('div')
      card.className = `data-type-card risk-${dt.riskLevel}`

      // Header: name + risk pill
      let html = `
        <div class="data-type-header">
          <span class="data-type-name">${escapeHtml(dt.dataType)}</span>
          <span class="risk-pill ${dt.riskLevel}">${dt.riskLevel}</span>
        </div>
      `

      // Purposes
      if (dt.purposes && dt.purposes.length > 0) {
        html += `<div class="data-type-purposes">${escapeHtml(dt.purposes.slice(0, 3).join(', '))}</div>`
      }

      // Third-party sharing
      if (dt.sharedWithThirdParties) {
        const cats = dt.thirdPartyCategories && dt.thirdPartyCategories.length > 0
          ? ` (${escapeHtml(dt.thirdPartyCategories.join(', '))})`
          : ''
        html += `<div class="data-type-third-party"><span class="status-dot warning"></span> Shared with third parties${cats}</div>`
      }

      // Warning note
      if (dt.warningNote) {
        html += `<div class="data-type-warning"><span class="status-dot warning"></span> ${escapeHtml(dt.warningNote)}</div>`
      }

      // Opt-out indicator
      const guidance = dt.optOutGuidance
      if (guidance) {
        const statusLabels = {
          available: '<span class="status-dot available"></span> Opt-out available',
          vague: '<span class="status-dot warning"></span> Vague opt-out language',
          unavailable: '<span class="status-dot unavailable"></span> No opt-out found',
        }
        const statusClass = guidance.status || 'unavailable'
        html += `<div class="optout-indicator ${statusClass}">${statusLabels[statusClass] || statusLabels.unavailable}</div>`

        // Action buttons for available mechanisms
        if (guidance.status === 'available' && guidance.mechanisms && guidance.mechanisms.length > 0) {
          html += '<div class="data-type-actions">'
          for (const mech of guidance.mechanisms) {
            if (mech.type === 'settings_url' || mech.type === 'web_form') {
              html += `<div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">${escapeHtml(mech.value)}</div>`
              html += `<button class="action-btn primary" data-action="open-url" data-url="${escapeAttr(mech.value)}">Opt Out</button>`
            } else if (mech.type === 'email') {
              html += `<div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">Email: ${escapeHtml(mech.value)}</div>`
              html += `<button class="action-btn primary" data-action="send-email" data-email="${escapeAttr(mech.value)}" data-domain="${escapeAttr(analysis.targetDomain)}" data-datatype="${escapeAttr(dt.dataType)}">Send Email</button>`
            } else if (mech.type === 'postal_mail') {
              html += `<div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">Mail: ${escapeHtml(mech.value)}</div>`
              html += `<button class="action-btn" data-action="add-calendar" data-domain="${escapeAttr(analysis.targetDomain)}" data-datatype="${escapeAttr(dt.dataType)}">Add to Calendar</button>`
            } else if (mech.type === 'account_steps') {
              html += `<div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">Steps: ${escapeHtml(mech.value)}</div>`
            }
            if (mech.instructionText) {
              html += `<div style="font-size: 10px; color: var(--text-muted); font-style: italic; margin-bottom: 4px;">${escapeHtml(mech.instructionText)}</div>`
            }
          }
          html += '</div>'
        }
      }

      card.innerHTML = html
      container.appendChild(card)
    }
  } else {
    const noData = document.createElement('div')
    noData.style.cssText = 'font-size: 13px; color: var(--text-secondary); font-style: italic; padding: 8px 0;'
    noData.textContent = 'No personal data collection detected in the policy.'
    container.appendChild(noData)
  }

  // Analysis warnings
  if (analysis.analysisWarnings && analysis.analysisWarnings.length > 0) {
    const warnings = document.createElement('div')
    warnings.className = 'policy-analysis-warnings'
    warnings.innerHTML = analysis.analysisWarnings.map(w => `<div><span class="status-dot warning"></span> ${escapeHtml(w)}</div>`).join('')
    container.appendChild(warnings)
  }

  // Model info
  if (analysis.modelUsed) {
    const model = document.createElement('div')
    model.className = 'policy-analysis-model'
    model.textContent = `Model: ${analysis.modelUsed}`
    container.appendChild(model)
  }

  // Wire up action buttons
  container.querySelectorAll('.action-btn').forEach(actionBtn => {
    actionBtn.addEventListener('click', handlePolicyActionClick)
  })
}

/**
 * Handle clicks on action buttons inside policy analysis cards.
 */
function handlePolicyActionClick(e) {
  const btn = e.currentTarget
  const action = btn.getAttribute('data-action')

  if (action === 'open-url') {
    const url = btn.getAttribute('data-url')
    if (url) {
      chrome.tabs.create({ url })
      btn.textContent = 'Opened'
      btn.disabled = true
    }
  } else if (action === 'send-email') {
    const email = btn.getAttribute('data-email')
    const domain = btn.getAttribute('data-domain')
    const dataType = btn.getAttribute('data-datatype')
    if (email) {
      const mailtoLink = buildMailtoLink(email, domain, dataType)
      chrome.tabs.create({ url: mailtoLink })
      btn.textContent = 'Opened'
      btn.disabled = true
    }
  } else if (action === 'add-calendar') {
    const domain = btn.getAttribute('data-domain')
    const dataType = btn.getAttribute('data-datatype')
    const icsContent = buildIcsContent(domain, dataType, 3)
    const filename = `optout-reminder-${domain}-${(dataType || '').replace(/\s+/g, '-')}.ics`
    downloadIcsBlob(icsContent, filename)
    btn.textContent = 'Downloaded'
    btn.disabled = true
  }
}

/**
 * Escape HTML entities for safe insertion.
 */
function escapeHtml(str) {
  if (!str) return ''
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

/**
 * Escape a string for use in an HTML attribute.
 */
function escapeAttr(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Trigger policy analysis from the popup.
 * Reads stored metadata for the domain, finds the first policy URL,
 * sends INITIATE_ANALYSIS to background, and renders results.
 */
async function analyzePolicyFromPopup(domain, policyUrlFromScan) {
  const btn = el('analyze-policy-btn')
  const loadingEl = el('policy-analysis-loading')
  const contentEl = el('policy-analysis-content')

  // Show loading state
  if (btn) {
    btn.textContent = 'Analyzing...'
    btn.disabled = true
  }
  if (loadingEl) loadingEl.classList.remove('hidden')
  if (contentEl) contentEl.innerHTML = ''

  try {
    let policyUrl = policyUrlFromScan || null

    if (!policyUrl) {
      // Fallback: check stored metadata from our content script
      const metadataKey = `metadata_${domain}`
      const metadataKeyWww = `metadata_www.${domain}`
      const stored = await new Promise(resolve => {
        chrome.storage.local.get([metadataKey, metadataKeyWww], result => {
          resolve(result[metadataKey] || result[metadataKeyWww] || null)
        })
      })

      if (stored && stored.detectedPolicyLinks && stored.detectedPolicyLinks.length > 0) {
        const privacyLink = stored.detectedPolicyLinks.find(l => l.linkType === 'privacy_policy')
        policyUrl = privacyLink ? privacyLink.url : stored.detectedPolicyLinks[0].url
      }
    }

    if (!policyUrl) {
      // Fallback: try to ask the content script for policy links
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab && tab.id) {
        try {
          const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_POLICY_LINKS' })
          if (resp && resp.links && resp.links.length > 0) {
            const privacyLink = resp.links.find(l => l.linkType === 'privacy_policy')
            policyUrl = privacyLink ? privacyLink.url : resp.links[0].url
          }
        } catch (_) {
          // Content script may not support this message — that's fine
        }
      }
    }

    if (!policyUrl) {
      // Fallback: try common privacy policy URL patterns
      const commonPaths = ['/privacy', '/privacy-policy', '/legal/privacy', '/about/privacy']
      for (const path of commonPaths) {
        try {
          const testUrl = `https://${domain}${path}`
          const resp = await fetch(testUrl, { method: 'HEAD', redirect: 'follow' })
          if (resp.ok) {
            policyUrl = testUrl
            break
          }
        } catch (_) {
          // Try next path
        }
      }
    }

    if (!policyUrl) {
      throw new Error('No privacy policy link found. Try visiting the site first so DataGuard can detect policy links.')
    }

    // Step 2: Send INITIATE_ANALYSIS to background
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'INITIATE_ANALYSIS', payload: { policyUrl } },
        (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
          } else {
            resolve(resp)
          }
        }
      )
    })

    if (loadingEl) loadingEl.classList.add('hidden')

    if (response && response.success && response.analysis) {
      renderPolicyAnalysis(response.analysis)
    } else {
      // Show error
      const errorMsg = (response && response.error && response.error.message)
        ? response.error.message
        : 'Analysis failed. Please check your API key in Settings.'
      const contentDiv = el('policy-analysis-content')
      contentDiv.innerHTML = `<div class="policy-analysis-error">${escapeHtml(errorMsg)}</div>`

      // Show retry button if retryable
      if (response && response.error && response.error.retryable) {
        if (btn) {
          btn.textContent = 'Retry Analysis'
          btn.disabled = false
          btn.classList.remove('hidden')
        }
      } else if (btn) {
        btn.textContent = 'Analyze Privacy Policy'
        btn.disabled = false
        btn.classList.remove('hidden')
      }
    }
  } catch (err) {
    if (loadingEl) loadingEl.classList.add('hidden')
    const contentDiv = el('policy-analysis-content')
    contentDiv.innerHTML = `<div class="policy-analysis-error">${escapeHtml(err.message || 'An unexpected error occurred.')}</div>`

    if (btn) {
      btn.textContent = 'Analyze Privacy Policy'
      btn.disabled = false
      btn.classList.remove('hidden')
    }
  }
}

/**
 * Initialize the policy analysis section: check for cached results, wire up button.
 */
async function initPolicyAnalysis(domain, policyUrlFromScan) {
  const btn = el('analyze-policy-btn')
  const contentEl = el('policy-analysis-content')

  // No cache — always show the analyze button, run fresh analysis each time

  // Wire up the analyze button
  if (btn) {
    btn.addEventListener('click', () => {
      analyzePolicyFromPopup(domain, policyUrlFromScan)
    })
  }
}

// ─── Main flow ────────────────────────────────────────────────────────────────

async function init() {
  await loadOptOutDb()

  // Get the active tab
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

  if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://')) {
    hide('loading')
    show('error-screen')
    return
  }

  // Step 1: Get page data from content script
  let pageData
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_DATA' })
    if (!response || !response.success) throw new Error(response?.error || 'No response from content script')
    pageData = response.data
  } catch (err) {
    // Content script may not be injected yet — try scripting API
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['DataGuard/content.js'] })
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_DATA' })
      if (!response || !response.success) throw new Error(response?.error || 'Injection failed')
      pageData = response.data
    } catch (err2) {
      hide('loading')
      el('error-message').textContent = 'Unable to scan this page.'
      show('error-screen')
      return
    }
  }

  // Step 2: Get breach data from background
  let domainBreaches = []
  let categoryBreaches = []
  try {
    const breachResponse = await chrome.runtime.sendMessage({
      type: 'GET_BREACH_DATA',
      domain: pageData.domain,
      categories: pageData.categories,
    })
    if (breachResponse && breachResponse.success) {
      domainBreaches = breachResponse.domainBreaches || []
      categoryBreaches = breachResponse.categoryBreaches || []
    }
  } catch (_) {
    // Breach data unavailable — continue without it
  }

  // Step 3: Compute risk
  const { level, reasons } = computeRisk({
    categories: pageData.categories,
    breaches: domainBreaches,
    hasHttps: pageData.hasHttps,
    policyUrl: pageData.policyUrl,
  })

  // Step 4: Render
  hide('loading')
  show('main')

  renderHeader(pageData)
  renderRiskBadge(level)
  const optOutEntry = findOptOut(pageData.domain)
  const dataUsage = optOutEntry ? (optOutEntry.data_usage || 'unknown') : 'unknown'

  // Only show "What this site collects" if fields were detected
  if (pageData.categories.length > 0) {
    renderCategories(pageData.categories, pageData.fieldDetails || [], dataUsage)
  } else {
    el('section-collects').classList.add('hidden')
  }

  // Only show "Why we flagged it" if there are meaningful reasons (not just "no fields detected")
  const meaningfulReasons = reasons.filter(r => !r.includes('No data input fields'))
  if (meaningfulReasons.length > 0) {
    renderReasons(meaningfulReasons)
  } else {
    el('section-reasons').classList.add('hidden')
  }

  // Show breach history only if breaches were found, otherwise show "coming soon" style
  if (domainBreaches.length > 0 || categoryBreaches.length > 0) {
    renderBreaches(domainBreaches, categoryBreaches)
  } else {
    el('section-breaches').querySelector('.breach-tabs').classList.add('hidden')
    el('domain-breach-list').innerHTML = `
      <div style="text-align: center; padding: 12px 0;">
        <div style="margin-bottom: 6px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--risk-low);"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
        <p class="no-breach-msg" style="font-weight: 500;">No breaches found</p>
        <p class="no-breach-caveat">We check the Have I Been Pwned database. No record doesn't guarantee safety.</p>
      </div>
    `
  }

  // Hide the static opt-out section — AI analysis provides better opt-out guidance
  el('section-optout').classList.add('hidden')

  renderScanTime()
  initBookmarkBtn(pageData.domain)
  initPolicyAnalysis(pageData.domain, pageData.policyUrl)

  // Settings link
  document.getElementById('settings-link').addEventListener('click', (e) => {
    e.preventDefault()
    chrome.runtime.openOptionsPage()
  })
}

init()
