import type {
  ExtensionMessage,
  PolicyLink,
  Page_Metadata,
  FieldCategoryId,
  FieldDetail,
  TrackerInfo,
  PageScanResult,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Field Classification (from DataGuard)
// ═══════════════════════════════════════════════════════════════════════════════

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
// Policy Link Detection
// ═══════════════════════════════════════════════════════════════════════════════

const POLICY_TEXT_PATTERNS = [
  /privacy\s*(policy)?/i,
  /terms\s*(of\s*(service|use))?/i,
  /data\s*(protection|processing)/i,
  /cookie\s*(policy|notice)/i,
];

const POLICY_HREF_PATTERNS = [
  /privacy/i, /terms/i, /legal/i, /tos/i, /gdpr/i,
];

function scanDomForPolicyLinks(doc: Document): PolicyLink[] {
  const links: PolicyLink[] = [];
  const anchors = doc.querySelectorAll('a[href]');
  for (const anchor of anchors) {
    const linkText = (anchor.textContent || '').trim();
    const href = anchor.getAttribute('href');
    if (!href) continue;
    let absoluteUrl: string;
    try { absoluteUrl = new URL(href, window.location.origin).href; } catch { continue; }
    const textMatches = POLICY_TEXT_PATTERNS.some(p => p.test(linkText));
    const hrefMatches = POLICY_HREF_PATTERNS.some(p => p.test(href));
    if (textMatches || hrefMatches) {
      links.push({ url: absoluteUrl, linkText, linkType: classifyLinkType(linkText, href) });
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
// Consent Dialog Detection
// ═══════════════════════════════════════════════════════════════════════════════

const CONSENT_DIALOG_SELECTORS = [
  '[id*="cookie"]', '[class*="consent"]', '[id*="gdpr"]',
  '[aria-label*="cookie"]', '[class*="cookie"]', '[id*="consent"]',
];

function detectConsentDialog(doc: Document): boolean {
  for (const selector of CONSENT_DIALOG_SELECTORS) {
    if (doc.querySelector(selector)) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tracker Detection
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
// Page Metadata & Scan
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
      try { return new URL(href, window.location.href).href; } catch (_) { return href; }
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
  return {
    domain: window.location.hostname.replace(/^www\./, ''),
    companyName: getCompanyName(),
    pageType: detectPageType(),
    categories: [...categorySet],
    fieldDetails,
    trackers: detectTrackers(),
    policyUrl: findPrivacyPolicyUrl(),
    hasHttps: window.location.protocol === 'https:',
    url: window.location.href,
    title: document.title,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Signup Flow Detection (Req 2.2)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect if the page has a consent/agreement checkbox near terms/privacy links.
 * This is the ONLY condition that should trigger the auto-notification banner.
 * We look for checkboxes whose labels reference terms, privacy, or agreement.
 */
function detectConsentAgreement(): { found: boolean; policyUrl: string | null } {
  const checkboxes = document.querySelectorAll('input[type="checkbox"]');
  const consentPatterns = /i agree|i accept|i have read|terms|privacy|consent|tos|conditions|policy/i;

  for (const cb of checkboxes) {
    // Check the label text around this checkbox
    const labelText = getLabelText(cb);
    const parentText = cb.closest('label, div, p, span, li')?.textContent || '';
    const combinedText = `${labelText} ${parentText}`.toLowerCase();

    if (consentPatterns.test(combinedText)) {
      // Found a consent checkbox — look for a nearby policy link
      const container = cb.closest('form, div, section, fieldset') || document.body;
      const nearbyLinks = container.querySelectorAll('a[href]');
      for (const link of nearbyLinks) {
        const href = link.getAttribute('href') || '';
        const linkText = (link.textContent || '').toLowerCase();
        if (/privacy|terms|tos|legal|policy|conditions/.test(href + ' ' + linkText)) {
          try {
            return { found: true, policyUrl: new URL(href, window.location.href).href };
          } catch (_) {
            return { found: true, policyUrl: href };
          }
        }
      }
      // Consent checkbox found but no nearby link — still flag it
      return { found: true, policyUrl: findPrivacyPolicyUrl() };
    }
  }

  return { found: false, policyUrl: null };
}

// ═══════════════════════════════════════════════════════════════════════════════
// In-Page Popup (styled to match DataGuard)
//
// Shows a polished popup for:
// 1. Cookie/consent dialogs detected
// 2. Terms agreement checkboxes found
// 3. Analysis complete/error notifications
// ═══════════════════════════════════════════════════════════════════════════════

const DG_STYLES = `
  @keyframes dg-slide-in { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
  #dataguard-popup {
    position: fixed; top: 16px; right: 16px; width: 340px;
    background: #FFFFFF; color: #1F2937; border-radius: 14px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.05);
    z-index: 2147483647; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px; line-height: 1.5; animation: dg-slide-in 0.3s ease-out;
    overflow: hidden;
  }
  @media (prefers-color-scheme: dark) {
    #dataguard-popup { background: #1F2937; color: #F3F4F6; box-shadow: 0 8px 30px rgba(0,0,0,0.4); }
    #dataguard-popup .dg-body { border-color: #374151; }
    #dataguard-popup .dg-btn-primary { background: #059669; }
    #dataguard-popup .dg-btn-dismiss { color: #9CA3AF; border-color: #374151; }
    #dataguard-popup .dg-btn-dismiss:hover { background: #374151; }
    #dataguard-popup .dg-detail { color: #9CA3AF; }
  }
  #dataguard-popup .dg-header {
    display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px;
    border-bottom: 1px solid #E5E7EB;
  }
  #dataguard-popup .dg-header-icon { font-size: 22px; }
  #dataguard-popup .dg-header-text { font-weight: 700; font-size: 14px; flex: 1; }
  #dataguard-popup .dg-close {
    background: none; border: none; font-size: 18px; cursor: pointer;
    color: #9CA3AF; padding: 2px 6px; border-radius: 6px; line-height: 1;
  }
  #dataguard-popup .dg-close:hover { background: #F3F4F6; color: #1F2937; }
  #dataguard-popup .dg-body { padding: 12px 16px; }
  #dataguard-popup .dg-detail { font-size: 12px; color: #6B7280; margin-bottom: 10px; }
  #dataguard-popup .dg-actions { display: flex; gap: 8px; }
  #dataguard-popup .dg-btn-primary {
    flex: 1; padding: 9px 14px; background: #059669; color: #fff; border: none;
    border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
    text-align: center; transition: opacity 0.15s;
  }
  #dataguard-popup .dg-btn-primary:hover { opacity: 0.88; }
  #dataguard-popup .dg-btn-dismiss {
    padding: 9px 14px; background: none; color: #6B7280; border: 1px solid #E5E7EB;
    border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer;
    transition: background 0.15s;
  }
  #dataguard-popup .dg-btn-dismiss:hover { background: #F9FAFB; }
`;

function showDataGuardPopup(opts: {
  title: string;
  detail: string;
  primaryLabel?: string;
  primaryAction?: () => void;
  autoDismissMs?: number;
}) {
  // Remove existing
  document.getElementById('dataguard-popup')?.remove();
  document.getElementById('dataguard-popup-style')?.remove();

  // Inject styles
  const style = document.createElement('style');
  style.id = 'dataguard-popup-style';
  style.textContent = DG_STYLES;
  document.head.appendChild(style);

  const popup = document.createElement('div');
  popup.id = 'dataguard-popup';

  const hasPrimary = opts.primaryLabel && opts.primaryAction;

  popup.innerHTML = `
    <div class="dg-header">
      <span class="dg-header-icon">\u{1F6E1}\uFE0F</span>
      <span class="dg-header-text">${opts.title}</span>
      <button class="dg-close" id="dg-close-btn">&times;</button>
    </div>
    <div class="dg-body">
      <div class="dg-detail">${opts.detail}</div>
      <div class="dg-actions">
        ${hasPrimary ? `<button class="dg-btn-primary" id="dg-primary-btn">${opts.primaryLabel}</button>` : ''}
        <button class="dg-btn-dismiss" id="dg-dismiss-btn">Dismiss</button>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  const dismiss = () => {
    popup.style.transition = 'opacity 0.2s, transform 0.2s';
    popup.style.opacity = '0';
    popup.style.transform = 'translateY(-10px)';
    setTimeout(() => { popup.remove(); style.remove(); }, 200);
  };

  document.getElementById('dg-close-btn')?.addEventListener('click', dismiss);
  document.getElementById('dg-dismiss-btn')?.addEventListener('click', dismiss);

  if (hasPrimary) {
    document.getElementById('dg-primary-btn')?.addEventListener('click', () => {
      opts.primaryAction!();
      dismiss();
    });
  }

  if (opts.autoDismissMs) {
    setTimeout(() => { if (document.getElementById('dataguard-popup')) dismiss(); }, opts.autoDismissMs);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════════════════════

function initContentScript() {
  const metadata = extractPageMetadata(document);

  // Always send metadata to background for storage
  if (metadata.detectedPolicyLinks.length > 0) {
    chrome.runtime.sendMessage({
      type: 'POLICY_DETECTED',
      payload: metadata,
    } as ExtensionMessage);
  }

  // 1. Consent checkbox detected — full popup with analyze button
  const consent = detectConsentAgreement();
  if (consent.found) {
    showDataGuardPopup({
      title: 'Terms Agreement Detected',
      detail: 'This page asks you to agree to terms or a privacy policy. DataGuard can analyze it before you accept.',
      primaryLabel: consent.policyUrl ? '\u{1F916} Analyze Policy' : '\u{1F50D} Open DataGuard',
      primaryAction: () => {
        if (consent.policyUrl) {
          chrome.runtime.sendMessage({
            type: 'INITIATE_ANALYSIS',
            payload: { policyUrl: consent.policyUrl },
          } as ExtensionMessage);
        }
      },
    });
    return; // Don't also show cookie popup
  }

  // 2. Cookie/consent dialog detected — popup offering to analyze
  if (metadata.hasConsentDialog && metadata.detectedPolicyLinks.length > 0) {
    const privacyLink = metadata.detectedPolicyLinks.find(l => l.linkType === 'privacy_policy')
      || metadata.detectedPolicyLinks[0];
    showDataGuardPopup({
      title: 'Cookie Dialog Detected',
      detail: 'This site is asking for cookie/tracking consent. Want DataGuard to analyze their privacy policy?',
      primaryLabel: '\u{1F916} Analyze Policy',
      primaryAction: () => {
        chrome.runtime.sendMessage({
          type: 'INITIATE_ANALYSIS',
          payload: { policyUrl: privacyLink.url },
        } as ExtensionMessage);
      },
      autoDismissMs: 15000,
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContentScript);
} else {
  initContentScript();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Message Listener
//
// The content script no longer renders analysis results itself.
// It stores them in chrome.storage so the popup can read them,
// and shows a small banner pointing the user to the popup.
// ═══════════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
  if (message.type === 'GET_PAGE_DATA') {
    try { sendResponse({ success: true, data: scanPage() }); }
    catch (err) { sendResponse({ success: false, error: (err as Error).message }); }
    return true;
  }

  if (message.type === 'ANALYSIS_COMPLETE') {
    showDataGuardPopup({
      title: 'Analysis Complete',
      detail: 'DataGuard has finished analyzing the privacy policy. Click the DataGuard icon in your toolbar to see the full results.',
      primaryLabel: 'Got it',
      primaryAction: () => {},
      autoDismissMs: 10000,
    });
  }

  if (message.type === 'ANALYSIS_ERROR') {
    showDataGuardPopup({
      title: 'Analysis Issue',
      detail: message.payload?.message || 'Something went wrong. Open DataGuard for details.',
      autoDismissMs: 10000,
    });
  }

  return true;
});
