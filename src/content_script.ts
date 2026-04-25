import type { ExtensionMessage, PolicyLink, Page_Metadata, ShowAlertPopupMessage } from './types.js';

// ─── Task 2.1: Policy Link Detection ─────────────────────────────────────────

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

export function scanDomForPolicyLinks(document: Document): PolicyLink[] {
  const links: PolicyLink[] = [];
  const anchors = document.querySelectorAll('a[href]');

  for (const anchor of anchors) {
    const linkText = (anchor.textContent || '').trim();
    const href = anchor.getAttribute('href');
    if (!href) continue;

    // Resolve relative URLs to absolute
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(href, window.location.origin).href;
    } catch {
      continue; // Skip invalid URLs
    }

    // Check if link text or href matches policy patterns
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

// ─── Task 2.3: Consent Dialog Detection and Page Metadata ────────────────────

const CONSENT_DIALOG_SELECTORS = [
  '[id*="cookie"]',
  '[class*="consent"]',
  '[id*="gdpr"]',
  '[aria-label*="cookie"]',
  '[class*="cookie"]',
  '[id*="consent"]',
];

export function detectConsentDialog(document: Document): boolean {
  for (const selector of CONSENT_DIALOG_SELECTORS) {
    if (document.querySelector(selector)) {
      return true;
    }
  }
  return false;
}

export function extractPageMetadata(document: Document): Page_Metadata {
  return {
    domain: window.location.hostname,
    pageTitle: document.title,
    pageUrl: window.location.href,
    detectedPolicyLinks: scanDomForPolicyLinks(document),
    hasConsentDialog: detectConsentDialog(document),
    detectionTimestamp: new Date().toISOString(),
  };
}

// ─── Task 2.5: Message Handling and Alert Popup Injection ────────────────────

// On page load, extract metadata and send to background
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContentScript);
} else {
  initContentScript();
}

function initContentScript() {
  const metadata = extractPageMetadata(document);
  
  // Only send message if policy links were detected (Req 1.6)
  if (metadata.detectedPolicyLinks.length > 0) {
    chrome.runtime.sendMessage({
      type: 'POLICY_DETECTED',
      payload: metadata,
    } as ExtensionMessage);
  }
}

// Listen for SHOW_ALERT_POPUP message from background
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'SHOW_ALERT_POPUP') {
    injectAlertPopup(message.payload);
  }
});

function injectAlertPopup(payload: ShowAlertPopupMessage['payload']) {
  // Remove existing popup if present
  const existing = document.getElementById('privacy-tool-alert-popup');
  if (existing) existing.remove();

  // Create overlay
  const overlay = document.createElement('div');
  overlay.id = 'privacy-tool-alert-popup';
  overlay.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: 320px;
    background: white;
    border: 2px solid #4CAF50;
    border-radius: 8px;
    padding: 16px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 2147483647;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    color: #333;
  `;

  // Build content
  let html = '<div style="font-weight: bold; margin-bottom: 12px;">🔒 Privacy Policy Detected</div>';
  
  if (payload.hasConsentDialog) {
    html += '<div style="margin-bottom: 8px; color: #666;">⚠️ Cookie consent dialog present</div>';
  }

  html += '<div style="margin-bottom: 12px;">Found policy links:</div>';
  html += '<ul style="margin: 0 0 12px 0; padding-left: 20px;">';
  
  for (const link of payload.policyLinks.slice(0, 3)) { // Show max 3 links
    html += `<li style="margin-bottom: 4px;"><a href="${link.url}" target="_blank" style="color: #1976D2; text-decoration: none;">${link.linkText || link.linkType}</a></li>`;
  }
  
  html += '</ul>';
  
  // Add analyze button for first link
  if (payload.policyLinks.length > 0) {
    html += `<button id="privacy-tool-analyze-btn" style="
      width: 100%;
      padding: 10px;
      background: #4CAF50;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
      font-size: 14px;
    ">Analyze Privacy Policy</button>`;
  }
  
  // Add close button
  html += `<button id="privacy-tool-close-btn" style="
    position: absolute;
    top: 8px;
    right: 8px;
    background: transparent;
    border: none;
    font-size: 20px;
    cursor: pointer;
    color: #999;
  ">×</button>`;

  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  // Attach event listeners
  const analyzeBtn = document.getElementById('privacy-tool-analyze-btn');
  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'INITIATE_ANALYSIS',
        payload: { policyUrl: payload.policyLinks[0].url },
      } as ExtensionMessage);
      
      // Update button to show loading state
      analyzeBtn.textContent = 'Analyzing...';
      (analyzeBtn as HTMLButtonElement).disabled = true;
    });
  }

  const closeBtn = document.getElementById('privacy-tool-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      overlay.remove();
    });
  }
}
