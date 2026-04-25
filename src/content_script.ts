import type {
  ExtensionMessage,
  PolicyLink,
  Page_Metadata,
  ShowAlertPopupMessage,
  Risk_Analysis,
  AnalysisErrorMessage,
  OptOutGuidance,
  OptOutStatus,
  FieldCategoryId,
  FieldDetail,
  TrackerInfo,
  PageScanResult,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Field Classification (from DataGuard)
// ═══════════════════════════════════════════════════════════════════════════════

const CATEGORIES: Record<FieldCategoryId, { id: string; label: string; icon: string; sensitivity: number }> = {
  FINANCIAL:     { id: 'financial',     label: 'Financial',      icon: '\u{1F4B3}', sensitivity: 5 },
  GOVERNMENT_ID: { id: 'government_id', label: 'Government ID',  icon: '\u{1FAAA}', sensitivity: 5 },
  AUTH:          { id: 'auth',          label: 'Authentication', icon: '\u{1F510}', sensitivity: 4 },
  IDENTITY:      { id: 'identity',      label: 'Identity',       icon: '\u{1F464}', sensitivity: 3 },
  CONTACT:       { id: 'contact',       label: 'Contact',        icon: '\u{1F4EC}', sensitivity: 2 },
  SENSITIVE:     { id: 'sensitive',     label: 'Sensitive',      icon: '\u{2695}\u{FE0F}', sensitivity: 5 },
};

interface ClassificationRule {
  category: FieldCategoryId;
  typeMatch: string[];
  autocompleteMatch: string[];
  nameRegex: RegExp;
  labelRegex: RegExp;
}

const RULES: ClassificationRule[] = [
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
];

const SKIP_TYPES = new Set(['submit', 'button', 'reset', 'image', 'hidden', 'file', 'range', 'color', 'checkbox', 'radio']);

function getLabelText(el: Element): string {
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label')!;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent || '';
  }
  if ((el as HTMLElement).id) {
    try {
      const labelEl = document.querySelector(`label[for="${CSS.escape((el as HTMLElement).id)}"]`);
      if (labelEl) return labelEl.textContent || '';
    } catch (_) { /* ignore */ }
  }
  const parentLabel = el.closest('label');
  if (parentLabel) return parentLabel.textContent || '';
  const prev = el.previousElementSibling;
  if (prev && ['LABEL', 'SPAN', 'P', 'DIV'].includes(prev.tagName)) {
    return prev.textContent || '';
  }
  return '';
}

function classifyField(el: Element): FieldCategoryId | null {
  const type = (el.getAttribute('type') || el.tagName).toLowerCase();
  if (SKIP_TYPES.has(type)) return null;

  const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
  const name = (el.getAttribute('name') || (el as HTMLElement).id || '').toLowerCase();
  const labelText = getLabelText(el);

  for (const rule of RULES) {
    if (rule.typeMatch.includes(type)) return rule.category;
    if (rule.autocompleteMatch.some(ac => autocomplete.includes(ac))) return rule.category;
    if (rule.nameRegex.test(name)) return rule.category;
    if (rule.labelRegex.test(labelText)) return rule.category;
  }
  return null;
}


// ═══════════════════════════════════════════════════════════════════════════════
// Policy Link Detection (from backend)
// ═══════════════════════════════════════════════════════════════════════════════

const POLICY_TEXT_PATTERNS = [
  /privacy\s*(policy)?/i,
  /terms\s*(of\s*(service|use))?/i,
  /data\s*(protection|processing)/i,
  /cookie\s*(policy|notice)/i,
];

const POLICY_HREF_PATTERNS = [
  /privacy/i,
  /terms/i,
  /legal/i,
  /tos/i,
  /gdpr/i,
];

function scanDomForPolicyLinks(doc: Document): PolicyLink[] {
  const links: PolicyLink[] = [];
  const anchors = doc.querySelectorAll('a[href]');

  for (const anchor of anchors) {
    const linkText = (anchor.textContent || '').trim();
    const href = anchor.getAttribute('href');
    if (!href) continue;

    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(href, window.location.origin).href;
    } catch {
      continue;
    }

    const textMatches = POLICY_TEXT_PATTERNS.some(pattern => pattern.test(linkText));
    const hrefMatches = POLICY_HREF_PATTERNS.some(pattern => pattern.test(href));

    if (textMatches || hrefMatches) {
      links.push({
        url: absoluteUrl,
        linkText,
        linkType: classifyLinkType(linkText, href),
      });
    }
  }

  return links;
}

function classifyLinkType(linkText: string, href: string): PolicyLink['linkType'] {
  const combined = `${linkText} ${href}`.toLowerCase();
  if (/privacy/.test(combined)) return 'privacy_policy';
  if (/terms/.test(combined)) return 'terms_of_service';
  if (/cookie/.test(combined)) return 'cookie_policy';
  if (/data\s*(protection|processing)/.test(combined)) return 'data_processing';
  return 'unknown';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Consent Dialog Detection (from backend)
// ═══════════════════════════════════════════════════════════════════════════════

const CONSENT_DIALOG_SELECTORS = [
  '[id*="cookie"]',
  '[class*="consent"]',
  '[id*="gdpr"]',
  '[aria-label*="cookie"]',
  '[class*="cookie"]',
  '[id*="consent"]',
];

function detectConsentDialog(doc: Document): boolean {
  for (const selector of CONSENT_DIALOG_SELECTORS) {
    if (doc.querySelector(selector)) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tracker Detection (from DataGuard)
// ═══════════════════════════════════════════════════════════════════════════════

const KNOWN_TRACKERS: { pattern: RegExp; name: string; category: string }[] = [
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
];

function detectTrackers(): TrackerInfo[] {
  const scripts = document.querySelectorAll('script[src]');
  const found = new Map<string, TrackerInfo>();
  for (const script of scripts) {
    const src = script.getAttribute('src') || '';
    for (const tracker of KNOWN_TRACKERS) {
      if (tracker.pattern.test(src) && !found.has(tracker.name)) {
        found.set(tracker.name, { name: tracker.name, category: tracker.category });
      }
    }
  }
  return [...found.values()];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Page Metadata & Scan (merged)
// ═══════════════════════════════════════════════════════════════════════════════

function getCompanyName(): string {
  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  if (ogSiteName) return ogSiteName.getAttribute('content') || '';
  const appName = document.querySelector('meta[name="application-name"]');
  if (appName) return appName.getAttribute('content') || '';
  return '';
}

function detectPageType(): string {
  const url = window.location.href.toLowerCase();
  const title = document.title.toLowerCase();
  if (/login|sign.?in|log.?in/.test(url + title)) return 'login';
  if (/sign.?up|register|create.?account/.test(url + title)) return 'signup';
  if (/checkout|payment|billing|order/.test(url + title)) return 'checkout';
  if (/account|settings|profile|preferences/.test(url + title)) return 'account_settings';
  return 'generic';
}

function findPrivacyPolicyUrl(): string | null {
  const links = document.querySelectorAll('a[href]');
  for (const link of links) {
    const text = (link.textContent || '').toLowerCase();
    const href = link.getAttribute('href') || '';
    if (/privacy\s*policy|privacy\s*notice|data\s*policy/.test(text) || /privacy/.test(href)) {
      try {
        return new URL(href, window.location.href).href;
      } catch (_) {
        return href;
      }
    }
  }
  return null;
}

function extractPageMetadata(doc: Document): Page_Metadata {
  return {
    domain: window.location.hostname,
    pageTitle: doc.title,
    pageUrl: window.location.href,
    detectedPolicyLinks: scanDomForPolicyLinks(doc),
    hasConsentDialog: detectConsentDialog(doc),
    detectionTimestamp: new Date().toISOString(),
  };
}

function scanPage(): PageScanResult {
  const inputs = document.querySelectorAll('input, textarea, select');
  const categorySet = new Set<FieldCategoryId>();
  const fieldDetails: FieldDetail[] = [];

  for (const el of inputs) {
    const category = classifyField(el);
    if (!category) continue;
    categorySet.add(category);
    const labelText = getLabelText(el).trim().slice(0, 80);
    fieldDetails.push({
      category,
      label: labelText || el.getAttribute('placeholder') || el.getAttribute('name') || 'Unnamed field',
      type: el.getAttribute('type') || el.tagName.toLowerCase(),
    });
  }

  const domain = window.location.hostname.replace(/^www\./, '');
  const companyName = getCompanyName();
  const pageType = detectPageType();
  const policyUrl = findPrivacyPolicyUrl();
  const trackers = detectTrackers();
  const hasHttps = window.location.protocol === 'https:';

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
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// Signup Flow Detection (Req 2.2 - auto-trigger analysis)
// ═══════════════════════════════════════════════════════════════════════════════

function detectSignupFlow(): boolean {
  const url = window.location.href.toLowerCase();
  const title = document.title.toLowerCase();
  const bodyText = document.body ? document.body.innerText.slice(0, 3000).toLowerCase() : '';
  const combined = url + ' ' + title + ' ' + bodyText;

  // Check URL/title patterns
  if (/sign.?up|register|create.?account|join|enroll|get.?started/.test(url + title)) {
    return true;
  }

  // Check for signup form indicators
  const forms = document.querySelectorAll('form');
  for (const form of forms) {
    const action = (form.getAttribute('action') || '').toLowerCase();
    const formText = form.textContent?.toLowerCase() || '';
    if (/sign.?up|register|create|join/.test(action) ||
        /create\s*(an?\s*)?account|sign\s*up|register|join\s*(now|free|us)/i.test(formText)) {
      // Check if form has password + email fields (strong signup signal)
      const hasPassword = form.querySelector('input[type="password"]');
      const hasEmail = form.querySelector('input[type="email"], input[autocomplete="email"]');
      if (hasPassword && hasEmail) return true;
    }
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Alert Popup Injection (from backend)
// ═══════════════════════════════════════════════════════════════════════════════

function injectAlertPopup(payload: ShowAlertPopupMessage['payload']) {
  const existing = document.getElementById('privacy-tool-alert-popup');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'privacy-tool-alert-popup';
  overlay.style.cssText = `
    position: fixed; top: 20px; right: 20px; width: 320px;
    background: white; border: 2px solid #4CAF50; border-radius: 8px;
    padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 2147483647; font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px; color: #333;
  `;

  let html = '<div style="font-weight: bold; margin-bottom: 12px;">&#x1F512; Privacy Policy Detected</div>';

  if (payload.hasConsentDialog) {
    html += '<div style="margin-bottom: 8px; color: #666;">&#x26A0;&#xFE0F; Cookie consent dialog present</div>';
  }

  html += '<div style="margin-bottom: 12px;">Found policy links:</div>';
  html += '<ul style="margin: 0 0 12px 0; padding-left: 20px;">';

  for (const link of payload.policyLinks.slice(0, 3)) {
    html += `<li style="margin-bottom: 4px;"><a href="${link.url}" target="_blank" style="color: #1976D2; text-decoration: none;">${link.linkText || link.linkType}</a></li>`;
  }

  html += '</ul>';

  if (payload.policyLinks.length > 0) {
    html += `<button id="privacy-tool-analyze-btn" style="
      width: 100%; padding: 10px; background: #4CAF50; color: white;
      border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px;
    ">Analyze Privacy Policy</button>`;
  }

  html += `<button id="privacy-tool-close-btn" style="
    position: absolute; top: 8px; right: 8px; background: transparent;
    border: none; font-size: 20px; cursor: pointer; color: #999;
  ">&times;</button>`;

  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  const analyzeBtn = document.getElementById('privacy-tool-analyze-btn');
  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'INITIATE_ANALYSIS',
        payload: { policyUrl: payload.policyLinks[0].url },
      } as ExtensionMessage);
      analyzeBtn.textContent = 'Analyzing...';
      (analyzeBtn as HTMLButtonElement).disabled = true;
    });
  }

  const closeBtn = document.getElementById('privacy-tool-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => overlay.remove());
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Opt-Out Guidance Helpers (from backend)
// ═══════════════════════════════════════════════════════════════════════════════

function normalizeOptOutGuidance(analysis: Risk_Analysis): Risk_Analysis {
  return {
    ...analysis,
    dataTypes: analysis.dataTypes.map(dt => ({
      ...dt,
      optOutGuidance: dt.optOutGuidance ?? {
        status: 'unavailable' as OptOutStatus,
        mechanisms: [],
        summary: 'Opt-out information was not extracted for this analysis.',
        warningNote: null,
      },
    })),
  };
}

function renderOptOutMechanism(mechanism: { type: string; value: string; instructionText: string | null }): string {
  let html = '';
  switch (mechanism.type) {
    case 'settings_url':
    case 'web_form':
      html += `<div style="margin-top: 4px; font-size: 12px;">
        &#x1F517; <a href="${mechanism.value}" target="_blank" rel="noopener noreferrer" style="color: #1976D2; text-decoration: underline;">${mechanism.value}</a>
      </div>`;
      break;
    case 'email':
      html += `<div style="margin-top: 4px; font-size: 12px;">
        &#x2709;&#xFE0F; <a href="mailto:${mechanism.value}" style="color: #1976D2; text-decoration: underline;">${mechanism.value}</a>
      </div>`;
      break;
    case 'account_steps':
      html += `<div style="margin-top: 4px; font-size: 12px;">&#x1F4CB; Steps:</div>`;
      html += '<ol style="margin: 4px 0 0 20px; padding: 0; font-size: 12px;">';
      const steps = mechanism.value.split('\n').filter((s: string) => s.trim());
      for (const step of steps) {
        html += `<li style="margin-bottom: 2px;">${step.trim()}</li>`;
      }
      html += '</ol>';
      break;
    case 'postal_mail':
      html += `<div style="margin-top: 4px; font-size: 12px;">&#x1F4EC; ${mechanism.value}</div>`;
      break;
  }
  if (mechanism.instructionText) {
    html += `<div style="margin-top: 2px; font-size: 11px; color: #555; font-style: italic;">${mechanism.instructionText}</div>`;
  }
  return html;
}

function renderOptOutSection(guidance: OptOutGuidance): string {
  let html = '<div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed #ddd;">';
  if (guidance.status === 'available') {
    html += '<div style="font-size: 12px; color: #4CAF50; font-weight: bold;">&#x2705; Opt-out available</div>';
    for (const mechanism of guidance.mechanisms) {
      html += renderOptOutMechanism(mechanism);
    }
  } else if (guidance.status === 'vague') {
    html += '<div style="font-size: 12px; color: #FF9800; font-weight: bold;">&#x26A0;&#xFE0F; Vague opt-out language</div>';
    html += `<div style="font-size: 11px; color: #555; margin-top: 2px;">${guidance.summary}</div>`;
    if (guidance.warningNote) {
      html += `<div style="font-size: 11px; color: #FF9800; margin-top: 2px;">&#x26A0; ${guidance.warningNote}</div>`;
    }
  } else {
    html += '<div style="font-size: 12px; color: #999;">&#x274C; No opt-out option found in the policy for this data type.</div>';
  }
  html += '</div>';
  return html;
}

function showAnalysisResults(analysis: Risk_Analysis) {
  const overlay = document.getElementById('privacy-tool-alert-popup');
  if (!overlay) return;

  const isLegacyData = analysis.dataTypes.some(dt => dt.optOutGuidance === undefined);
  const normalized = normalizeOptOutGuidance(analysis);

  const riskColors: Record<string, string> = { low: '#4CAF50', medium: '#FF9800', high: '#F44336' };
  const riskColor = riskColors[normalized.overallRiskLevel] || '#666';

  let html = `
    <button id="privacy-tool-close-btn" style="position: absolute; top: 8px; right: 8px; background: transparent; border: none; font-size: 20px; cursor: pointer; color: #999;">&times;</button>
    <div style="font-weight: bold; margin-bottom: 8px;">&#x1F512; Privacy Analysis Complete</div>
    <div style="margin-bottom: 12px;">
      <span style="font-weight: bold;">Overall Risk: </span>
      <span style="color: ${riskColor}; font-weight: bold; text-transform: uppercase;">${normalized.overallRiskLevel}</span>
    </div>
    <div style="margin-bottom: 8px; font-size: 12px; color: #666;">
      ${normalized.targetDomain} &middot; ${normalized.dataTypes.length} data types found
    </div>
  `;

  // Req 2.5: Data Collection Category Grid (Grey/Blue/Yellow/Red)
  if (normalized.dataCategoryGrid && normalized.dataCategoryGrid.length > 0) {
    const gridColors: Record<string, { bg: string; color: string; label: string }> = {
      grey:   { bg: '#F3F4F6', color: '#6B7280', label: 'Not collected' },
      blue:   { bg: '#DBEAFE', color: '#1D4ED8', label: 'Collected' },
      yellow: { bg: '#FEF3C7', color: '#92400E', label: 'Shared' },
      red:    { bg: '#FEE2E2', color: '#991B1B', label: 'Sold' },
    };

    html += `<div style="margin-bottom: 10px;">
      <div style="font-weight: bold; font-size: 12px; margin-bottom: 6px;">Data Collection Summary</div>
      <div style="display: flex; gap: 4px; margin-bottom: 6px; font-size: 10px;">
        <span style="padding: 2px 6px; background: #F3F4F6; border-radius: 3px; color: #6B7280;">&#x26AA; Not collected</span>
        <span style="padding: 2px 6px; background: #DBEAFE; border-radius: 3px; color: #1D4ED8;">&#x1F535; Collected</span>
        <span style="padding: 2px 6px; background: #FEF3C7; border-radius: 3px; color: #92400E;">&#x1F7E1; Shared</span>
        <span style="padding: 2px 6px; background: #FEE2E2; border-radius: 3px; color: #991B1B;">&#x1F534; Sold</span>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 3px;">`;

    for (const item of normalized.dataCategoryGrid) {
      const gc = gridColors[item.collectionStatus] || gridColors.grey;
      html += `<div style="padding: 4px 8px; background: ${gc.bg}; color: ${gc.color}; border-radius: 4px; font-size: 11px; font-weight: 500;">${item.category}</div>`;
    }

    html += `</div></div>`;
  }

  if (isLegacyData) {
    html += `<div style="margin-bottom: 10px; padding: 8px; background: #E3F2FD; border-radius: 4px; font-size: 12px; color: #1565C0;">
      &#x2139;&#xFE0F; Opt-out information is not available for this analysis.
      <button id="privacy-tool-reanalyze-btn" style="display: block; margin-top: 6px; padding: 6px 12px; background: #1976D2; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">Re-analyze with opt-out extraction</button>
    </div>`;
  }

  if (normalized.dataTypes.length > 0) {
    const availableCount = normalized.dataTypes.filter(dt => dt.optOutGuidance?.status === 'available').length;
    const vagueCount = normalized.dataTypes.filter(dt => dt.optOutGuidance?.status === 'vague').length;
    const unavailableCount = normalized.dataTypes.filter(dt => dt.optOutGuidance?.status === 'unavailable').length;

    html += `<div style="margin-bottom: 10px; padding: 8px; background: #FAFAFA; border-radius: 4px; font-size: 12px;">
      <div style="font-weight: bold; margin-bottom: 4px;">Opt-Out Summary</div>
      <div style="color: #4CAF50;">&#x2705; ${availableCount} data type${availableCount !== 1 ? 's' : ''} with opt-out available</div>
      <div style="color: #FF9800;">&#x26A0;&#xFE0F; ${vagueCount} data type${vagueCount !== 1 ? 's' : ''} with vague opt-out language</div>
      <div style="color: #999;">&#x274C; ${unavailableCount} data type${unavailableCount !== 1 ? 's' : ''} with no opt-out found</div>
    </div>`;

    html += '<div style="max-height: 300px; overflow-y: auto;">';
    for (const dt of normalized.dataTypes) {
      const dtColor = riskColors[dt.riskLevel] || '#666';
      html += `<div style="margin-bottom: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px; border-left: 3px solid ${dtColor};">
        <div style="font-weight: bold; font-size: 13px;">${dt.dataType}
          <span style="color: ${dtColor}; font-size: 11px; text-transform: uppercase;"> ${dt.riskLevel}</span>
        </div>
        <div style="font-size: 12px; color: #555; margin-top: 4px;">${dt.purposes.slice(0, 2).join(', ')}</div>
        ${dt.sharedWithThirdParties ? '<div style="font-size: 11px; color: #F44336; margin-top: 2px;">&#x26A0; Shared with third parties</div>' : ''}
        ${dt.warningNote ? `<div style="font-size: 11px; color: #FF9800; margin-top: 2px;">&#x26A0; ${dt.warningNote}</div>` : ''}
        ${dt.optOutGuidance ? renderOptOutSection(dt.optOutGuidance) : ''}
      </div>`;
    }
    html += '</div>';
  } else {
    html += '<div style="color: #666; font-style: italic;">No personal data collection detected.</div>';
  }

  if (normalized.analysisWarnings.length > 0) {
    html += '<div style="margin-top: 8px; font-size: 11px; color: #999;">';
    for (const w of normalized.analysisWarnings) {
      html += `<div>&#x26A0; ${w}</div>`;
    }
    html += '</div>';
  }

  html += `<div style="margin-top: 8px; font-size: 10px; color: #bbb;">Model: ${normalized.modelUsed}</div>`;

  overlay.innerHTML = html;
  overlay.style.maxHeight = '500px';
  overlay.style.overflowY = 'auto';

  const closeBtn = document.getElementById('privacy-tool-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', () => overlay.remove());

  if (isLegacyData) {
    const reanalyzeBtn = document.getElementById('privacy-tool-reanalyze-btn');
    if (reanalyzeBtn) {
      reanalyzeBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          type: 'INITIATE_ANALYSIS',
          payload: { policyUrl: normalized.policyUrl },
        } as ExtensionMessage);
        reanalyzeBtn.textContent = 'Re-analyzing...';
        (reanalyzeBtn as HTMLButtonElement).disabled = true;
      });
    }
  }
}

function showAnalysisError(error: AnalysisErrorMessage['payload']) {
  const overlay = document.getElementById('privacy-tool-alert-popup');
  if (!overlay) return;

  let html = `
    <button id="privacy-tool-close-btn" style="position: absolute; top: 8px; right: 8px; background: transparent; border: none; font-size: 20px; cursor: pointer; color: #999;">&times;</button>
    <div style="font-weight: bold; margin-bottom: 8px; color: #F44336;">&#x274C; Analysis Failed</div>
    <div style="margin-bottom: 12px;">${error.message}</div>
  `;

  if (error.retryable) {
    html += `<button id="privacy-tool-retry-btn" style="width: 100%; padding: 10px; background: #FF9800; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Retry</button>`;
  }

  overlay.innerHTML = html;

  const closeBtn = document.getElementById('privacy-tool-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', () => overlay.remove());
}


// ═══════════════════════════════════════════════════════════════════════════════
// Initialization (merged)
// ═══════════════════════════════════════════════════════════════════════════════

function initContentScript() {
  const metadata = extractPageMetadata(document);

  // Req 1.1-1.3: Notify background if policy links detected
  if (metadata.detectedPolicyLinks.length > 0) {
    chrome.runtime.sendMessage({
      type: 'POLICY_DETECTED',
      payload: metadata,
    } as ExtensionMessage);
  }

  // Req 2.2: Auto-trigger analysis in signup flows
  if (detectSignupFlow() && metadata.detectedPolicyLinks.length > 0) {
    const privacyLink = metadata.detectedPolicyLinks.find(l => l.linkType === 'privacy_policy')
      || metadata.detectedPolicyLinks[0];
    chrome.runtime.sendMessage({
      type: 'INITIATE_ANALYSIS',
      payload: { policyUrl: privacyLink.url },
    } as ExtensionMessage);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContentScript);
} else {
  initContentScript();
}

// ─── Message listener (merged) ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: ExtensionMessage | any, _sender, sendResponse) => {
  // DataGuard: page scan request from popup
  if (message.type === 'GET_PAGE_DATA') {
    try {
      sendResponse({ success: true, data: scanPage() });
    } catch (err) {
      sendResponse({ success: false, error: (err as Error).message });
    }
    return true;
  }

  // Backend: alert popup injection
  if (message.type === 'SHOW_ALERT_POPUP') {
    injectAlertPopup(message.payload);
  }

  // Backend: analysis results
  if (message.type === 'ANALYSIS_COMPLETE') {
    showAnalysisResults(message.payload);
  }

  // Backend: analysis error
  if (message.type === 'ANALYSIS_ERROR') {
    showAnalysisError(message.payload);
  }

  return true;
});
