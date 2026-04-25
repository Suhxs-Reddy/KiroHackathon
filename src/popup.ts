/**
 * popup.ts — Merged DataGuard popup
 * Orchestrates: page data from content script, breach data from background,
 * AI policy analysis, jurisdiction rights, and opt-out guidance.
 */

import type {
  FieldCategoryId,
  FieldDetail,
  TrackerInfo,
  PageScanResult,
  RiskLevel,
  HIBPBreach,
  OptOutDatabaseEntry,
  OptOutAlternative,
  ExtensionMessage,
  JurisdictionId,
  PrivacyRight,
} from './types.js';

// ─── Category metadata ────────────────────────────────────────────────────────

const CATEGORY_META: Record<FieldCategoryId, { label: string; icon: string; cssClass: string; description: string; usedFor: string }> = {
  FINANCIAL:     { label: 'Financial',      icon: '\u{1F4B3}', cssClass: 'financial',
    description: 'This site collects financial information such as credit/debit card numbers, CVV codes, or billing details.',
    usedFor: 'Used for payment processing. Exposed in breaches, this data enables fraud and identity theft.' },
  GOVERNMENT_ID: { label: 'Government ID',  icon: '\u{1FAAA}', cssClass: 'government_id',
    description: 'This site collects government-issued identification such as Social Security Numbers, passport numbers, or driver\'s license numbers.',
    usedFor: 'Used for identity verification. Extremely sensitive \u2014 exposure enables identity theft.' },
  AUTH:          { label: 'Authentication', icon: '\u{1F510}', cssClass: 'auth',
    description: 'This site collects authentication credentials such as passwords, PINs, or security question answers.',
    usedFor: 'Used to verify your identity. Exposed passwords can compromise all accounts where you reuse them.' },
  IDENTITY:      { label: 'Identity',       icon: '\u{1F464}', cssClass: 'identity',
    description: 'This site collects personal identity information such as your full name, date of birth, or home address.',
    usedFor: 'Used for account creation and verification. Can be combined with other data for identity theft.' },
  CONTACT:       { label: 'Contact',        icon: '\u{1F4EC}', cssClass: 'contact',
    description: 'This site collects contact information such as your email address or phone number.',
    usedFor: 'Used for communication and account recovery. Often sold to data brokers or used for spam.' },
  SENSITIVE:     { label: 'Sensitive',      icon: '\u{2695}\u{FE0F}', cssClass: 'sensitive',
    description: 'This site collects sensitive personal data such as health information, biometric data, or demographic details.',
    usedFor: 'Highly sensitive \u2014 can affect insurance, employment, and personal safety if exposed.' },
};

const RISK_META: Record<RiskLevel, { label: string; icon: string; cssClass: string }> = {
  high:   { label: 'HIGH RISK',   icon: '\u{1F534}', cssClass: 'high' },
  medium: { label: 'MEDIUM RISK', icon: '\u{1F7E1}', cssClass: 'medium' },
  low:    { label: 'LOW RISK',    icon: '\u{1F7E2}', cssClass: 'low' },
};

// ─── Risk scorer (inline) ─────────────────────────────────────────────────────

const HIGH_SENSITIVITY_CATS = new Set<FieldCategoryId>(['FINANCIAL', 'GOVERNMENT_ID', 'SENSITIVE', 'AUTH']);
const SENSITIVITY: Record<string, number> = { FINANCIAL: 5, GOVERNMENT_ID: 5, SENSITIVE: 5, AUTH: 4, IDENTITY: 3, CONTACT: 2 };

function computeRisk({ categories, breaches, hasHttps, policyUrl }: {
  categories: FieldCategoryId[];
  breaches: HIBPBreach[];
  hasHttps: boolean;
  policyUrl: string | null;
}): { level: RiskLevel; reasons: string[]; score: number } {
  const reasons: string[] = [];
  let score = 0;

  if (categories.length === 0) {
    return { level: 'low', reasons: ['No data input fields detected on this page.'], score: 0 };
  }

  const maxSensitivity = Math.max(...categories.map(c => SENSITIVITY[c] ?? 1));
  score += maxSensitivity * 10;

  const hasHighSensitivity = categories.some(c => HIGH_SENSITIVITY_CATS.has(c));

  if (categories.includes('FINANCIAL'))     reasons.push('This page collects financial information (card number, CVV, or billing details).');
  if (categories.includes('GOVERNMENT_ID')) reasons.push('This page collects government-issued ID information (SSN, passport, driver\'s license).');
  if (categories.includes('AUTH'))          reasons.push('This page collects authentication credentials (password or security questions).');
  if (categories.includes('SENSITIVE'))     reasons.push('This page collects sensitive personal data (health, biometric, or demographic information).');
  if (categories.includes('IDENTITY'))      reasons.push('This page collects identity information (name, date of birth, or address).');
  if (categories.includes('CONTACT'))       reasons.push('This page collects contact information (email or phone number).');

  if (!hasHttps) {
    score += 30;
    reasons.push('\u26A0\uFE0F This page does not use HTTPS \u2014 data is transmitted unencrypted.');
  }

  if (!policyUrl) {
    score += 10;
    reasons.push('No privacy policy link was found on this page.');
  }

  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
  const recentBreaches = (breaches || []).filter(b => new Date(b.BreachDate) >= fiveYearsAgo);

  if (recentBreaches.length > 0) {
    score += recentBreaches.length * 15;
    const latest = recentBreaches[0];
    reasons.push(
      `This domain had ${recentBreaches.length} confirmed breach${recentBreaches.length > 1 ? 'es' : ''} in the last 5 years` +
      (latest ? ` (most recent: ${latest.Name}, ${latest.BreachDate.slice(0, 4)})` : '') + '.'
    );
  }

  let level: RiskLevel;
  if (score >= 50 || (hasHighSensitivity && recentBreaches.length > 0) || !hasHttps) {
    level = 'high';
  } else if (score >= 20 || hasHighSensitivity || categories.length >= 2) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { level, reasons, score };
}

// ─── Opt-out database ─────────────────────────────────────────────────────────

let optOutDb: OptOutDatabaseEntry[] = [];

async function loadOptOutDb() {
  try {
    const resp = await fetch(chrome.runtime.getURL('data/opt_out_database.json'));
    optOutDb = await resp.json();
  } catch (_) {
    optOutDb = [];
  }
}

function findOptOut(domain: string): OptOutDatabaseEntry | null {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return optOutDb.find(entry => {
    const ed = entry.domain.toLowerCase().replace(/^www\./, '');
    return ed === d || d.endsWith('.' + ed);
  }) || null;
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function el(id: string): HTMLElement { return document.getElementById(id)!; }
function show(id: string) { el(id).classList.remove('hidden'); }
function hide(id: string) { el(id).classList.add('hidden'); }

function formatNumber(n: number | undefined): string {
  if (!n) return 'Unknown';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (_) { return dateStr; }
}


// ─── Render functions ─────────────────────────────────────────────────────────

function renderHeader(pageData: PageScanResult) {
  el('domain-name').textContent = pageData.domain;
  if (pageData.companyName && pageData.companyName !== pageData.domain) {
    el('company-name').textContent = pageData.companyName;
  }
  const favicon = el('favicon') as HTMLImageElement;
  favicon.src = `https://www.google.com/s2/favicons?domain=${pageData.domain}&sz=32`;
  favicon.onerror = () => { favicon.style.display = 'none'; };
}

function renderRiskBadge(level: RiskLevel) {
  const meta = RISK_META[level] || RISK_META.low;
  const badge = el('risk-badge');
  badge.className = `risk-badge ${meta.cssClass}`;
  el('risk-icon').textContent = meta.icon;
  el('risk-label').textContent = meta.label;
}

const DATA_USAGE_META: Record<string, { label: string; cssClass: string; dot: string }> = {
  collected: { label: 'Collected',  cssClass: 'usage-collected', dot: '\u{1F535}' },
  shared:    { label: 'Shared',     cssClass: 'usage-shared',    dot: '\u{1F7E1}' },
  sold:      { label: 'Sold',       cssClass: 'usage-sold',      dot: '\u{1F534}' },
  unknown:   { label: 'Unknown',    cssClass: 'usage-unknown',   dot: '\u26AA' },
};

function renderCategories(categories: FieldCategoryId[], fieldDetails: FieldDetail[], dataUsage: string) {
  const pillsContainer = el('category-pills');
  pillsContainer.innerHTML = '';

  if (categories.length === 0) {
    show('no-fields');
    return;
  }

  hide('no-fields');

  // Legend
  const legend = document.createElement('div');
  legend.className = 'usage-legend';
  legend.innerHTML = `
    <span class="legend-title">Data usage on this site:</span>
    <span class="legend-item usage-collected">\u{1F535} Collected</span>
    <span class="legend-item usage-shared">\u{1F7E1} Shared</span>
    <span class="legend-item usage-sold">\u{1F534} Sold</span>
  `;
  pillsContainer.appendChild(legend);

  const usageMeta = DATA_USAGE_META[dataUsage] || DATA_USAGE_META.unknown;
  const usageBanner = document.createElement('div');
  usageBanner.className = `usage-banner ${usageMeta.cssClass}`;
  const usageText = usageMeta.label === 'Unknown' ? 'has unknown data practices'
    : usageMeta.label === 'Collected' ? 'only collects your data internally'
    : usageMeta.label === 'Shared' ? 'shares your data with third parties'
    : 'sells your data to third parties';
  usageBanner.innerHTML = `${usageMeta.dot} This site <strong>${usageText}</strong>`;
  pillsContainer.appendChild(usageBanner);

  for (const catId of categories) {
    const meta = CATEGORY_META[catId];
    if (!meta) continue;

    const pill = document.createElement('div');
    pill.className = `pill ${usageMeta.cssClass}-pill`;
    pill.innerHTML = `<span>${meta.icon}</span><span>${meta.label}</span>`;
    pillsContainer.appendChild(pill);

    const card = document.createElement('div');
    card.className = `field-detail-inline ${usageMeta.cssClass}-card`;

    const fields = fieldDetails.filter(f => f.category === catId);
    const fieldsHtml = fields.length === 0
      ? `<li><span class="field-type-badge">\u2014</span><span>Fields detected (labels not available)</span></li>`
      : fields.map(f =>
          `<li><span class="field-type-badge">${f.type}</span><span>${f.label}</span></li>`
        ).join('');

    card.innerHTML = `
      <p class="field-detail-desc">${meta.usedFor}</p>
      <ul class="field-list">${fieldsHtml}</ul>
    `;
    pillsContainer.appendChild(card);
  }
}

function renderReasons(reasons: string[]) {
  const list = el('reason-list');
  list.innerHTML = '';
  for (const reason of reasons) {
    const li = document.createElement('li');
    li.textContent = reason;
    list.appendChild(li);
  }
}

function renderBreachItem(breach: HIBPBreach): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'breach-item';

  const classes = (breach.DataClasses || []).slice(0, 5);
  const classesHtml = classes.map(c => `<span class="breach-class-tag">${c}</span>`).join('');

  div.innerHTML = `
    <div class="breach-item-header">
      <span class="breach-name">${breach.Name || breach.Domain || 'Unknown'}</span>
      <span class="breach-date">${formatDate(breach.BreachDate)}</span>
    </div>
    <div class="breach-accounts">
      ${breach.PwnCount ? `${formatNumber(breach.PwnCount)} accounts affected` : ''}
    </div>
    <div class="breach-classes">${classesHtml}</div>
  `;
  return div;
}

function renderBreaches(domainBreaches: HIBPBreach[], categoryBreaches: HIBPBreach[]) {
  const domainList = el('domain-breach-list');
  domainList.innerHTML = '';
  if (domainBreaches.length === 0) {
    domainList.innerHTML = `
      <p class="no-breach-msg">\u2713 No known breaches in our database</p>
      <p class="no-breach-caveat">Absence of a record doesn't guarantee this site has never been breached.</p>
    `;
  } else {
    domainBreaches.slice(0, 5).forEach(b => domainList.appendChild(renderBreachItem(b)));
  }

  const catList = el('category-breach-list');
  catList.innerHTML = '';
  if (categoryBreaches.length === 0) {
    catList.innerHTML = `<p class="no-breach-msg">No recent breaches found for the detected data types.</p>`;
  } else {
    categoryBreaches.slice(0, 5).forEach(b => catList.appendChild(renderBreachItem(b)));
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      (btn as HTMLElement).classList.add('active');
      show((btn as HTMLElement).dataset.tab!);
    });
  });
}

function renderOptOut(domain: string) {
  const container = el('optout-content');
  container.innerHTML = '';
  const entry = findOptOut(domain);

  if (entry) {
    const difficultyClass = entry.difficulty || 'medium';
    const difficultyLabel: Record<string, string> = { easy: '\u26A1 Easy', medium: '\u23F1 Medium', hard: '\u{1F527} Hard' };

    const altItems = (entry.alternatives || []).map(a => {
      if (typeof a === 'string') return `<li>${a}</li>`;
      return `<li><a href="${(a as OptOutAlternative).url}" target="_blank" rel="noopener noreferrer" class="alt-link">${(a as OptOutAlternative).text} \u2197</a></li>`;
    }).join('');

    container.innerHTML = `
      <div class="optout-cta">
        <a href="${entry.opt_out_url}" target="_blank" rel="noopener noreferrer" class="optout-btn">
          Go to opt-out page \u2197
        </a>
        <div class="optout-meta">
          <span class="difficulty-badge ${difficultyClass}">${difficultyLabel[difficultyClass] || difficultyClass}</span>
          <span class="optout-time">\u23F0 ${entry.estimated_time}</span>
        </div>
        ${entry.notes ? `<p class="optout-notes">${entry.notes}</p>` : ''}
        ${altItems ? `
          <button class="alternatives-toggle" aria-expanded="false">
            <span class="toggle-arrow">\u25B6</span>
            Alternative paths
          </button>
          <ul class="alternatives-list hidden">${altItems}</ul>
        ` : ''}
      </div>
    `;

    const toggle = container.querySelector('.alternatives-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const list = container.querySelector('.alternatives-list')!;
        const arrow = toggle.querySelector('.toggle-arrow')!;
        const isOpen = !list.classList.contains('hidden');
        list.classList.toggle('hidden', isOpen);
        arrow.classList.toggle('open', !isOpen);
        toggle.setAttribute('aria-expanded', String(!isOpen));
      });
    }
  } else {
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
    `;
  }
}

function renderScanTime() {
  el('scan-time').textContent = `Scanned ${new Date().toLocaleTimeString()}`;
}


// ─── Jurisdiction / Privacy Rights section (Req 5) ────────────────────────────

async function renderJurisdictionRights() {
  const container = el('rights-content');
  if (!container) return;

  const result = await chrome.storage.local.get(['dg_user_jurisdiction']);
  const userJurisdictions: JurisdictionId[] = result.dg_user_jurisdiction || [];

  if (userJurisdictions.length === 0) {
    container.innerHTML = `
      <div class="jurisdiction-setup">
        <p>Set your location to see which privacy laws protect you.</p>
        <button id="setup-jurisdiction-btn" class="optout-btn" style="margin-top: 8px;">Set Up Jurisdiction</button>
      </div>
    `;
    const setupBtn = document.getElementById('setup-jurisdiction-btn');
    if (setupBtn) {
      setupBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
      });
    }
    return;
  }

  // Load jurisdiction data inline (avoid import in popup context)
  const JURISDICTION_NAMES: Record<string, string> = {
    GDPR: 'GDPR (EU)', CCPA: 'CCPA (California)', CPRA: 'CPRA (California)',
    VCDPA: 'VCDPA (Virginia)', CPA: 'CPA (Colorado)', CTDPA: 'CTDPA (Connecticut)',
  };

  const JURISDICTION_RIGHTS: Record<string, { name: string; description: string }[]> = {
    GDPR: [
      { name: 'Right of Access', description: 'Ask what data they have about you and get a copy.' },
      { name: 'Right to Erasure', description: 'Ask them to delete your personal data.' },
      { name: 'Right to Object', description: 'Tell them to stop using your data for marketing.' },
      { name: 'Right to Data Portability', description: 'Get your data in a format you can move.' },
    ],
    CCPA: [
      { name: 'Right to Know', description: 'Ask what personal info they collect and why.' },
      { name: 'Right to Delete', description: 'Ask them to delete your personal info.' },
      { name: 'Right to Opt-Out of Sale', description: 'Tell them to stop selling your data.' },
    ],
    CPRA: [
      { name: 'Right to Correct', description: 'Ask them to fix inaccurate data.' },
      { name: 'Right to Limit Sensitive Data', description: 'Limit use of sensitive personal info.' },
    ],
    VCDPA: [
      { name: 'Right to Access', description: 'Confirm and get a copy of your data.' },
      { name: 'Right to Delete', description: 'Ask them to delete your data.' },
      { name: 'Right to Opt-Out', description: 'Opt out of targeted ads and data sale.' },
    ],
    CPA: [
      { name: 'Right to Access', description: 'Confirm and get a copy of your data.' },
      { name: 'Right to Delete', description: 'Ask them to delete your data.' },
      { name: 'Right to Opt-Out', description: 'Opt out of targeted ads and data sale.' },
    ],
    CTDPA: [
      { name: 'Right to Access', description: 'Confirm and get a copy of your data.' },
      { name: 'Right to Delete', description: 'Ask them to delete your data.' },
      { name: 'Right to Opt-Out', description: 'Opt out of targeted ads and data sale.' },
    ],
  };

  let html = '';
  for (const jId of userJurisdictions) {
    const name = JURISDICTION_NAMES[jId] || jId;
    const rights = JURISDICTION_RIGHTS[jId] || [];
    html += `<div class="jurisdiction-block">
      <div class="jurisdiction-name">\u{1F3DB}\uFE0F ${name}</div>
      <ul class="rights-list">`;
    for (const right of rights) {
      html += `<li><strong>${right.name}</strong>: ${right.description}</li>`;
    }
    html += `</ul></div>`;
  }

  container.innerHTML = html;
}

// ─── Policy Analysis trigger from popup ───────────────────────────────────────

function renderAnalyzeSection(policyUrl: string | null) {
  const container = el('analyze-content');
  if (!container) return;

  if (policyUrl) {
    container.innerHTML = `
      <div class="analyze-cta">
        <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">
          Found a privacy policy link. Analyze it with AI to get a plain-language summary.
        </p>
        <button id="analyze-policy-btn" class="optout-btn">
          \u{1F916} Analyze Privacy Policy
        </button>
        <div id="analyze-status" style="display: none; margin-top: 8px; font-size: 12px;"></div>
      </div>
    `;
    const analyzeBtn = document.getElementById('analyze-policy-btn');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', async () => {
        analyzeBtn.textContent = 'Analyzing...';
        (analyzeBtn as HTMLButtonElement).disabled = true;
        const statusDiv = document.getElementById('analyze-status')!;
        statusDiv.style.display = 'block';
        statusDiv.textContent = 'Sending to AI engine...';
        statusDiv.style.color = 'var(--text-muted)';

        try {
          const response = await chrome.runtime.sendMessage({
            type: 'INITIATE_ANALYSIS',
            payload: { policyUrl },
          });
          if (response && response.success) {
            statusDiv.textContent = '\u2713 Analysis complete! Check the page overlay for results.';
            statusDiv.style.color = 'var(--risk-low)';
          } else {
            statusDiv.textContent = `Analysis failed: ${response?.error?.message || 'Unknown error'}`;
            statusDiv.style.color = 'var(--risk-high)';
            analyzeBtn.textContent = '\u{1F916} Retry Analysis';
            (analyzeBtn as HTMLButtonElement).disabled = false;
          }
        } catch (err) {
          statusDiv.textContent = `Error: ${(err as Error).message}`;
          statusDiv.style.color = 'var(--risk-high)';
          analyzeBtn.textContent = '\u{1F916} Retry Analysis';
          (analyzeBtn as HTMLButtonElement).disabled = false;
        }
      });
    }
  } else {
    container.innerHTML = `
      <div class="generic-optout">
        <p>No privacy policy link detected on this page.</p>
        <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
          You can paste policy text manually via the settings page.
        </p>
      </div>
    `;
  }
}

// ─── Bookmark feature ─────────────────────────────────────────────────────────

const BOOKMARKS_KEY = 'dg_bookmarked_sites';

async function getBookmarks(): Promise<Record<string, any>> {
  return new Promise(resolve => {
    chrome.storage.local.get([BOOKMARKS_KEY], result => {
      resolve(result[BOOKMARKS_KEY] || {});
    });
  });
}

async function saveBookmarks(bookmarks: Record<string, any>) {
  return new Promise<void>(resolve => {
    chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks }, resolve);
  });
}

async function initBookmarkBtn(domain: string) {
  const btn = document.getElementById('bookmark-btn');
  if (!btn) return;

  const bookmarks = await getBookmarks();
  const isBookmarked = !!bookmarks[domain];
  updateBookmarkBtn(btn, isBookmarked);

  btn.addEventListener('click', async () => {
    const current = await getBookmarks();
    const nowBookmarked = !!current[domain];

    if (nowBookmarked) {
      delete current[domain];
    } else {
      current[domain] = { addedAt: new Date().toISOString(), lastChecked: null };
    }

    await saveBookmarks(current);
    updateBookmarkBtn(btn, !nowBookmarked);

    const prev = btn.textContent;
    btn.textContent = nowBookmarked ? '\u2713 Removed' : '\u2713 Bookmarked!';
    (btn as HTMLButtonElement).disabled = true;
    setTimeout(() => {
      updateBookmarkBtn(btn, !nowBookmarked);
      (btn as HTMLButtonElement).disabled = false;
    }, 1200);
  });
}

function updateBookmarkBtn(btn: HTMLElement, isBookmarked: boolean) {
  if (isBookmarked) {
    btn.textContent = '\u{1F516} Bookmarked';
    btn.classList.add('bookmarked');
  } else {
    btn.textContent = '\u{1F516} Bookmark';
    btn.classList.remove('bookmarked');
  }
}

// ─── Main flow ────────────────────────────────────────────────────────────────

async function init() {
  await loadOptOutDb();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://')) {
    hide('loading');
    show('error-screen');
    return;
  }

  // Step 1: Get page data from content script
  let pageData: PageScanResult;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_DATA' });
    if (!response || !response.success) throw new Error(response?.error || 'No response from content script');
    pageData = response.data;
  } catch (err) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_script.js'] });
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_DATA' });
      if (!response || !response.success) throw new Error(response?.error || 'Injection failed');
      pageData = response.data;
    } catch (err2) {
      hide('loading');
      el('error-message').textContent = 'Unable to scan this page.';
      show('error-screen');
      return;
    }
  }

  // Step 2: Get breach data from background
  let domainBreaches: HIBPBreach[] = [];
  let categoryBreaches: HIBPBreach[] = [];
  try {
    const breachResponse = await chrome.runtime.sendMessage({
      type: 'GET_BREACH_DATA',
      domain: pageData.domain,
      categories: pageData.categories,
    });
    if (breachResponse && breachResponse.success) {
      domainBreaches = breachResponse.domainBreaches || [];
      categoryBreaches = breachResponse.categoryBreaches || [];
    }
  } catch (_) {
    // Breach data unavailable
  }

  // Step 3: Compute risk
  const { level, reasons } = computeRisk({
    categories: pageData.categories,
    breaches: domainBreaches,
    hasHttps: pageData.hasHttps,
    policyUrl: pageData.policyUrl,
  });

  // Step 4: Render
  hide('loading');
  show('main');

  renderHeader(pageData);
  renderRiskBadge(level);
  const optOutEntry = findOptOut(pageData.domain);
  const dataUsage = optOutEntry ? (optOutEntry.data_usage || 'unknown') : 'unknown';
  renderCategories(pageData.categories, pageData.fieldDetails || [], dataUsage);
  renderReasons(reasons);
  renderBreaches(domainBreaches, categoryBreaches);
  renderOptOut(pageData.domain);
  renderAnalyzeSection(pageData.policyUrl);
  renderJurisdictionRights();
  renderScanTime();
  initBookmarkBtn(pageData.domain);

  // Settings link
  document.getElementById('settings-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

init();
