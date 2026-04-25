/**
 * popup.ts — DataGuard popup
 * Single UI for: AI policy analysis, breach history, opt-out guidance,
 * jurisdiction rights, and debug logging.
 */

import type {
  FieldCategoryId,
  PageScanResult,
  RiskLevel,
  HIBPBreach,
  OptOutDatabaseEntry,
  OptOutAlternative,
  JurisdictionId,
} from './types.js';

// ─── Debug logger (writes to the popup's debug panel) ─────────────────────────

const debugLines: string[] = [];

function dbg(msg: string) {
  const ts = new Date().toLocaleTimeString();
  debugLines.push(`[${ts}] ${msg}`);
  console.log(`[DataGuard] ${msg}`);
}

function renderDebugLog() {
  const logEl = document.getElementById('debug-log');
  if (logEl) logEl.textContent = debugLines.join('\n');
}

// ─── Risk metadata ────────────────────────────────────────────────────────────

const RISK_META: Record<RiskLevel, { label: string; icon: string; cssClass: string }> = {
  high:   { label: 'HIGH RISK',   icon: '\u{1F534}', cssClass: 'high' },
  medium: { label: 'MEDIUM RISK', icon: '\u{1F7E1}', cssClass: 'medium' },
  low:    { label: 'LOW RISK',    icon: '\u{1F7E2}', cssClass: 'low' },
};

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
  try { return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch (_) { return dateStr; }
}

// ─── Opt-out database ─────────────────────────────────────────────────────────

let optOutDb: OptOutDatabaseEntry[] = [];

async function loadOptOutDb() {
  try {
    const resp = await fetch(chrome.runtime.getURL('data/opt_out_database.json'));
    optOutDb = await resp.json();
    dbg(`Loaded opt-out DB: ${optOutDb.length} entries`);
  } catch (_) { optOutDb = []; }
}

function findOptOut(domain: string): OptOutDatabaseEntry | null {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return optOutDb.find(entry => {
    const ed = entry.domain.toLowerCase().replace(/^www\./, '');
    return ed === d || d.endsWith('.' + ed);
  }) || null;
}


// ─── Render: Header ───────────────────────────────────────────────────────────

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

// ─── Render: Breach history ───────────────────────────────────────────────────

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
    <div class="breach-accounts">${breach.PwnCount ? `${formatNumber(breach.PwnCount)} accounts affected` : ''}</div>
    <div class="breach-classes">${classesHtml}</div>
  `;
  return div;
}

function renderBreaches(domainBreaches: HIBPBreach[], categoryBreaches: HIBPBreach[]) {
  const domainList = el('domain-breach-list');
  domainList.innerHTML = '';
  if (domainBreaches.length === 0) {
    domainList.innerHTML = `<p class="no-breach-msg">\u2713 No known breaches in our database</p>
      <p class="no-breach-caveat">Absence of a record doesn't guarantee this site has never been breached.</p>`;
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

// ─── Render: Opt-out ──────────────────────────────────────────────────────────

function renderOptOut(domain: string) {
  const container = el('optout-content');
  container.innerHTML = '';
  const entry = findOptOut(domain);

  if (entry) {
    const difficultyLabel: Record<string, string> = { easy: '\u26A1 Easy', medium: '\u23F1 Medium', hard: '\u{1F527} Hard' };
    const altItems = (entry.alternatives || []).map(a => {
      if (typeof a === 'string') return `<li>${a}</li>`;
      return `<li><a href="${(a as OptOutAlternative).url}" target="_blank" rel="noopener noreferrer" class="alt-link">${(a as OptOutAlternative).text} \u2197</a></li>`;
    }).join('');

    container.innerHTML = `
      <div class="optout-cta">
        <a href="${entry.opt_out_url}" target="_blank" rel="noopener noreferrer" class="optout-btn">Go to opt-out page \u2197</a>
        <div class="optout-meta">
          <span class="difficulty-badge ${entry.difficulty}">${difficultyLabel[entry.difficulty] || entry.difficulty}</span>
          <span class="optout-time">\u23F0 ${entry.estimated_time}</span>
        </div>
        ${entry.notes ? `<p class="optout-notes">${entry.notes}</p>` : ''}
        ${altItems ? `<button class="alternatives-toggle" aria-expanded="false"><span class="toggle-arrow">\u25B6</span> Alternative paths</button><ul class="alternatives-list hidden">${altItems}</ul>` : ''}
      </div>`;

    container.querySelector('.alternatives-toggle')?.addEventListener('click', function(this: HTMLElement) {
      const list = container.querySelector('.alternatives-list')!;
      const arrow = this.querySelector('.toggle-arrow')!;
      const isOpen = !list.classList.contains('hidden');
      list.classList.toggle('hidden', isOpen);
      arrow.classList.toggle('open', !isOpen);
      this.setAttribute('aria-expanded', String(!isOpen));
    });
  } else {
    container.innerHTML = `<div class="generic-optout">
      <p>No specific opt-out info found for <strong>${domain}</strong>. Try these steps:</p>
      <ol><li>Look for "Privacy" or "Account" in the site footer.</li>
      <li>Search <em>"${domain} delete account"</em>.</li>
      <li>If you're in the EU or California, request data deletion under GDPR/CCPA.</li></ol></div>`;
  }
}


// ─── Render: Privacy Policy Analysis ──────────────────────────────────────────

async function renderAnalyzeSection(policyUrl: string | null, domain: string) {
  const container = el('analyze-content');
  if (!container) return;

  dbg(`renderAnalyzeSection: domain=${domain}, policyUrl=${policyUrl ? 'yes' : 'no'}`);

  // Try multiple storage keys to find analysis results
  const storageKey = `analysis_${domain}`;
  const stored = await chrome.storage.local.get([storageKey, 'lastAnalysis', 'lastAnalysisError']);

  dbg(`Storage keys checked: ${storageKey}, lastAnalysis, lastAnalysisError`);
  dbg(`Found analysis_domain: ${!!stored[storageKey]}`);
  dbg(`Found lastAnalysis: ${!!stored.lastAnalysis}`);
  dbg(`Found lastAnalysisError: ${!!stored.lastAnalysisError}`);

  // Use domain-specific results first, then fall back to lastAnalysis
  let analysis = stored[storageKey];
  if (!analysis && stored.lastAnalysis) {
    // Check if lastAnalysis is for a related domain
    const lastDomain = stored.lastAnalysis.targetDomain || '';
    if (lastDomain.includes(domain) || domain.includes(lastDomain) || lastDomain === domain) {
      analysis = stored.lastAnalysis;
      dbg(`Using lastAnalysis (domain match: ${lastDomain})`);
    } else {
      dbg(`lastAnalysis domain mismatch: ${lastDomain} vs ${domain}`);
    }
  }

  if (analysis && analysis.dataTypes) {
    dbg(`Rendering analysis: ${analysis.dataTypes.length} data types, grid: ${analysis.dataCategoryGrid?.length || 0}`);
    renderAnalysisResults(container, analysis);
    renderDebugLog();
    return;
  }

  // Check for error
  if (stored.lastAnalysisError) {
    dbg(`Last error: ${stored.lastAnalysisError.message}`);
    container.innerHTML = `
      <div style="padding: 8px; background: var(--risk-high-bg); border-radius: var(--radius-sm); margin-bottom: 8px;">
        <p style="font-size: 12px; color: var(--risk-high); font-weight: 600;">\u274C ${stored.lastAnalysisError.message || 'Analysis failed'}</p>
      </div>
      ${policyUrl ? `<button id="analyze-policy-btn" class="optout-btn">\u{1F916} Retry Analysis</button>` : ''}
      <div id="analyze-status" style="display: none; margin-top: 8px; font-size: 12px;"></div>`;
    wireAnalyzeButton(policyUrl, domain);
    renderDebugLog();
    return;
  }

  // No results yet — show analyze button
  if (policyUrl) {
    dbg('No analysis yet, showing analyze button');
    container.innerHTML = `
      <div class="analyze-cta">
        <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">
          Found a privacy policy link. Analyze it with AI to get a plain-language summary.
        </p>
        <button id="analyze-policy-btn" class="optout-btn">\u{1F916} Analyze Privacy Policy</button>
        <div id="analyze-status" style="display: none; margin-top: 8px; font-size: 12px;"></div>
      </div>`;
    wireAnalyzeButton(policyUrl, domain);
  } else {
    dbg('No policy URL found on page');
    container.innerHTML = `<div class="generic-optout"><p>No privacy policy link detected on this page.</p></div>`;
  }
  renderDebugLog();
}

function wireAnalyzeButton(policyUrl: string | null, domain: string) {
  if (!policyUrl) return;
  const btn = document.getElementById('analyze-policy-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    btn.textContent = 'Analyzing\u2026';
    (btn as HTMLButtonElement).disabled = true;
    const statusDiv = document.getElementById('analyze-status')!;
    statusDiv.style.display = 'block';
    statusDiv.textContent = 'Sending to AI engine\u2026';
    statusDiv.style.color = 'var(--text-muted)';

    await chrome.storage.local.remove('lastAnalysisError');
    dbg(`Starting analysis for: ${policyUrl}`);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'INITIATE_ANALYSIS',
        payload: { policyUrl },
      });

      dbg(`Analysis response: success=${response?.success}, hasAnalysis=${!!response?.analysis}`);

      if (response && response.success && response.analysis) {
        // Store it ourselves too, keyed by the popup's domain
        const storageKey = `analysis_${domain}`;
        await chrome.storage.local.set({ [storageKey]: response.analysis, lastAnalysis: response.analysis });
        dbg('Stored analysis, re-rendering');
        renderAnalyzeSection(policyUrl, domain);
      } else if (response && response.success) {
        // Background stored it but didn't return it inline — re-read from storage
        dbg('Success but no inline analysis, re-reading from storage');
        setTimeout(() => renderAnalyzeSection(policyUrl, domain), 300);
      } else {
        const errMsg = response?.error?.message || response?.error || 'Unknown error';
        dbg(`Analysis failed: ${errMsg}`);
        statusDiv.textContent = `Analysis failed: ${errMsg}`;
        statusDiv.style.color = 'var(--risk-high)';
        btn.textContent = '\u{1F916} Retry Analysis';
        (btn as HTMLButtonElement).disabled = false;
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      dbg(`Analysis exception: ${errMsg}`);
      statusDiv.textContent = `Error: ${errMsg}`;
      statusDiv.style.color = 'var(--risk-high)';
      btn.textContent = '\u{1F916} Retry Analysis';
      (btn as HTMLButtonElement).disabled = false;
    }
    renderDebugLog();
  });
}

function renderAnalysisResults(container: HTMLElement, analysis: any) {
  const riskColors: Record<string, string> = { low: 'var(--risk-low)', medium: 'var(--risk-med)', high: 'var(--risk-high)' };

  let html = `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
    <span style="font-size: 16px;">\u{1F916}</span>
    <span style="font-weight: 600; font-size: 13px;">Overall Risk:</span>
    <span class="risk-badge ${analysis.overallRiskLevel}" style="font-size: 11px; padding: 3px 8px;">${(analysis.overallRiskLevel || 'unknown').toUpperCase()}</span>
  </div>`;

  // Data Collection Category Grid
  if (analysis.dataCategoryGrid && analysis.dataCategoryGrid.length > 0) {
    const gridMeta: Record<string, { bg: string; color: string; dot: string }> = {
      grey:   { bg: 'var(--bg-section)', color: 'var(--text-muted)', dot: '\u26AA' },
      blue:   { bg: '#EFF6FF', color: '#1D4ED8', dot: '\u{1F535}' },
      yellow: { bg: '#FFFBEB', color: '#92400E', dot: '\u{1F7E1}' },
      red:    { bg: '#FEF2F2', color: '#991B1B', dot: '\u{1F534}' },
    };
    html += `<div class="usage-legend" style="margin-bottom: 8px;">
      <span class="legend-title">Data collection:</span>
      <span class="legend-item" style="background: var(--bg-section); color: var(--text-muted);">\u26AA Not collected</span>
      <span class="legend-item usage-collected">\u{1F535} Collected</span>
      <span class="legend-item usage-shared">\u{1F7E1} Shared</span>
      <span class="legend-item usage-sold">\u{1F534} Sold</span>
    </div>`;
    html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 10px;">';
    for (const item of analysis.dataCategoryGrid) {
      const gm = gridMeta[item.collectionStatus] || gridMeta.grey;
      html += `<div style="padding: 5px 8px; background: ${gm.bg}; color: ${gm.color}; border-radius: var(--radius-sm); font-size: 11px; font-weight: 500;">${gm.dot} ${item.category}</div>`;
    }
    html += '</div>';
  }

  // Data types detail
  if (analysis.dataTypes && analysis.dataTypes.length > 0) {
    for (const dt of analysis.dataTypes) {
      const dtColor = riskColors[dt.riskLevel] || 'var(--text-secondary)';
      html += `<div style="margin-bottom: 6px; padding: 8px 10px; background: var(--bg-section); border: 1px solid var(--border); border-left: 3px solid ${dtColor}; border-radius: var(--radius-sm);">
        <div style="font-weight: 600; font-size: 12px;">${dt.dataType} <span style="color: ${dtColor}; font-size: 10px; text-transform: uppercase; margin-left: 4px;">${dt.riskLevel}</span></div>
        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 3px;">${(dt.purposes || []).slice(0, 2).join(', ')}</div>`;
      if (dt.sharedWithThirdParties) html += `<div style="font-size: 10px; color: var(--risk-high); margin-top: 2px;">\u26A0 Shared with third parties</div>`;
      if (dt.warningNote) html += `<div style="font-size: 10px; color: var(--risk-med); margin-top: 2px;">\u26A0 ${dt.warningNote}</div>`;
      if (dt.optOutGuidance) {
        const g = dt.optOutGuidance;
        if (g.status === 'available') {
          html += `<div style="font-size: 10px; color: var(--risk-low); margin-top: 3px; font-weight: 600;">\u2705 Opt-out available</div>`;
          for (const m of g.mechanisms || []) {
            if (m.type === 'settings_url' || m.type === 'web_form') html += `<div style="font-size: 10px; margin-top: 2px;">\u{1F517} <a href="${m.value}" target="_blank" rel="noopener" style="color: #2563EB;">${m.value}</a></div>`;
            else if (m.type === 'email') html += `<div style="font-size: 10px; margin-top: 2px;">\u2709\uFE0F <a href="mailto:${m.value}" style="color: #2563EB;">${m.value}</a></div>`;
            if (m.instructionText) html += `<div style="font-size: 10px; color: var(--text-muted); font-style: italic; margin-top: 1px;">${m.instructionText}</div>`;
          }
        } else if (g.status === 'vague') {
          html += `<div style="font-size: 10px; color: var(--risk-med); margin-top: 3px;">\u26A0\uFE0F Vague opt-out language: ${g.summary || ''}</div>`;
        } else {
          html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 3px;">\u274C No opt-out found</div>`;
        }
      }
      html += '</div>';
    }
  } else {
    html += '<div style="font-size: 12px; color: var(--text-muted); font-style: italic;">No personal data collection detected in the policy.</div>';
  }

  if (analysis.analysisWarnings?.length > 0) {
    html += '<div style="margin-top: 6px;">';
    for (const w of analysis.analysisWarnings) html += `<div style="font-size: 10px; color: var(--text-muted);">\u26A0 ${w}</div>`;
    html += '</div>';
  }

  html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">Model: ${analysis.modelUsed || 'unknown'} \u00B7 ${analysis.analyzedAt ? formatDate(analysis.analyzedAt) : ''}</div>`;

  container.innerHTML = html;
}


// ─── Render: Jurisdiction Rights ──────────────────────────────────────────────

async function renderJurisdictionRights() {
  const container = el('rights-content');
  if (!container) return;
  const result = await chrome.storage.local.get(['dg_user_jurisdiction']);
  const userJurisdictions: JurisdictionId[] = result.dg_user_jurisdiction || [];

  if (userJurisdictions.length === 0) {
    container.innerHTML = `<div class="jurisdiction-setup"><p>Set your location to see which privacy laws protect you.</p>
      <button id="setup-jurisdiction-btn" class="optout-btn" style="margin-top: 8px;">Set Up Jurisdiction</button></div>`;
    document.getElementById('setup-jurisdiction-btn')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
    return;
  }

  const RIGHTS: Record<string, { name: string; rights: { name: string; desc: string }[] }> = {
    GDPR: { name: 'GDPR (EU)', rights: [
      { name: 'Right of Access', desc: 'Ask what data they have about you.' },
      { name: 'Right to Erasure', desc: 'Ask them to delete your data.' },
      { name: 'Right to Object', desc: 'Stop them using your data for marketing.' },
    ]},
    CCPA: { name: 'CCPA (California)', rights: [
      { name: 'Right to Know', desc: 'Ask what info they collect and why.' },
      { name: 'Right to Delete', desc: 'Ask them to delete your info.' },
      { name: 'Right to Opt-Out of Sale', desc: 'Stop them selling your data.' },
    ]},
    CPRA: { name: 'CPRA (California)', rights: [
      { name: 'Right to Correct', desc: 'Fix inaccurate data.' },
      { name: 'Right to Limit Sensitive Data', desc: 'Limit use of sensitive info.' },
    ]},
    VCDPA: { name: 'VCDPA (Virginia)', rights: [{ name: 'Right to Access & Delete', desc: 'Get and delete your data.' }, { name: 'Right to Opt-Out', desc: 'Opt out of ads and data sale.' }]},
    CPA: { name: 'CPA (Colorado)', rights: [{ name: 'Right to Access & Delete', desc: 'Get and delete your data.' }, { name: 'Right to Opt-Out', desc: 'Opt out of ads and data sale.' }]},
    CTDPA: { name: 'CTDPA (Connecticut)', rights: [{ name: 'Right to Access & Delete', desc: 'Get and delete your data.' }, { name: 'Right to Opt-Out', desc: 'Opt out of ads and data sale.' }]},
  };

  let html = '';
  for (const jId of userJurisdictions) {
    const j = RIGHTS[jId];
    if (!j) continue;
    html += `<div class="jurisdiction-block"><div class="jurisdiction-name">\u{1F3DB}\uFE0F ${j.name}</div><ul class="rights-list">`;
    for (const r of j.rights) html += `<li><strong>${r.name}</strong>: ${r.desc}</li>`;
    html += `</ul></div>`;
  }
  container.innerHTML = html;
}

// ─── Bookmark ─────────────────────────────────────────────────────────────────

const BOOKMARKS_KEY = 'dg_bookmarked_sites';

async function initBookmarkBtn(domain: string) {
  const btn = document.getElementById('bookmark-btn');
  if (!btn) return;
  const bookmarks = await new Promise<Record<string, any>>(r => chrome.storage.local.get([BOOKMARKS_KEY], res => r(res[BOOKMARKS_KEY] || {})));
  let isBookmarked = !!bookmarks[domain];
  updateBookmarkBtn(btn, isBookmarked);

  btn.addEventListener('click', async () => {
    const current = await new Promise<Record<string, any>>(r => chrome.storage.local.get([BOOKMARKS_KEY], res => r(res[BOOKMARKS_KEY] || {})));
    if (current[domain]) { delete current[domain]; isBookmarked = false; }
    else { current[domain] = { addedAt: new Date().toISOString(), lastChecked: null }; isBookmarked = true; }
    await new Promise<void>(r => chrome.storage.local.set({ [BOOKMARKS_KEY]: current }, r));
    updateBookmarkBtn(btn, isBookmarked);
  });
}

function updateBookmarkBtn(btn: HTMLElement, isBookmarked: boolean) {
  btn.textContent = isBookmarked ? '\u{1F516} Bookmarked' : '\u{1F516} Bookmark';
  btn.classList.toggle('bookmarked', isBookmarked);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function init() {
  dbg('Popup init started');
  await loadOptOutDb();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://')) {
    hide('loading');
    show('error-screen');
    dbg('Cannot scan this page type');
    renderDebugLog();
    return;
  }

  dbg(`Tab: ${tab.url}`);

  // Get page data from content script
  let pageData: PageScanResult;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_DATA' });
    if (!response || !response.success) throw new Error(response?.error || 'No response');
    pageData = response.data;
    dbg(`Page scan: domain=${pageData.domain}, policyUrl=${pageData.policyUrl ? 'yes' : 'no'}`);
  } catch (err) {
    try {
      dbg('Content script not ready, injecting...');
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_script.js'] });
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_DATA' });
      if (!response || !response.success) throw new Error(response?.error || 'Injection failed');
      pageData = response.data;
      dbg(`Page scan (after inject): domain=${pageData.domain}`);
    } catch (err2) {
      hide('loading');
      el('error-message').textContent = 'Unable to scan this page.';
      show('error-screen');
      dbg(`Scan failed: ${(err2 as Error).message}`);
      renderDebugLog();
      return;
    }
  }

  // Get breach data
  let domainBreaches: HIBPBreach[] = [];
  let categoryBreaches: HIBPBreach[] = [];
  try {
    const breachResponse = await chrome.runtime.sendMessage({
      type: 'GET_BREACH_DATA', domain: pageData.domain, categories: pageData.categories,
    });
    if (breachResponse?.success) {
      domainBreaches = breachResponse.domainBreaches || [];
      categoryBreaches = breachResponse.categoryBreaches || [];
      dbg(`Breaches: ${domainBreaches.length} domain, ${categoryBreaches.length} category`);
    }
  } catch (_) { dbg('Breach data unavailable'); }

  // Determine risk level from breaches
  const hasRecentBreach = domainBreaches.some(b => {
    const fiveYearsAgo = new Date(); fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    return new Date(b.BreachDate) >= fiveYearsAgo;
  });
  const riskLevel: RiskLevel = hasRecentBreach ? 'high' : domainBreaches.length > 0 ? 'medium' : 'low';

  // Render
  hide('loading');
  show('main');

  renderHeader(pageData);
  renderRiskBadge(riskLevel);
  renderAnalyzeSection(pageData.policyUrl, pageData.domain);
  renderBreaches(domainBreaches, categoryBreaches);
  renderOptOut(pageData.domain);
  renderJurisdictionRights();
  el('scan-time').textContent = `Scanned ${new Date().toLocaleTimeString()}`;
  initBookmarkBtn(pageData.domain);

  // Debug toggle
  document.getElementById('toggle-debug')?.addEventListener('click', () => {
    const logEl = el('debug-log');
    logEl.classList.toggle('hidden');
    renderDebugLog();
  });

  // Settings link
  document.getElementById('settings-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  dbg('Popup render complete');
  renderDebugLog();
}

init();
