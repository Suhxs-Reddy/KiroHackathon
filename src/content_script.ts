import type { ExtensionMessage, PolicyLink, Page_Metadata, ShowAlertPopupMessage, Risk_Analysis, AnalysisErrorMessage, OptOutGuidance, OptOutStatus, ActionRecord, ReminderMetadata, OptOutMechanismType } from './types.js';

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

// Listen for messages from background
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'SHOW_ALERT_POPUP') {
    injectAlertPopup(message.payload);
  }
  if (message.type === 'ANALYSIS_COMPLETE') {
    showAnalysisResults(message.payload);
  }
  if (message.type === 'ANALYSIS_ERROR') {
    showAnalysisError(message.payload);
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


// ─── Opt-Out Guidance Helpers ──────────────────────────────────────────────────

export function buildMailtoLink(
  emailAddress: string,
  domain: string,
  dataType: string
): string {
  const subject = `Data Opt-Out Request — ${domain}`;

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
  ].join('\n');

  return `mailto:${emailAddress}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function buildIcsFile(domain: string, dataType: string, reminderType: string, delayDays: number): string {
  const now = new Date();
  const eventDate = new Date(now.getTime() + delayDays * 24 * 60 * 60 * 1000);

  const formatDate = (d: Date): string => {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };

  const titles: Record<string, string> = {
    postal_mail: `Send opt-out letter to ${domain} (${dataType})`,
    follow_up: `Follow up on opt-out request — ${domain} (${dataType})`,
    renewal: `Renew opt-out for ${dataType} — ${domain}`,
  };

  const descriptions: Record<string, string> = {
    postal_mail: `Reminder to send your opt-out letter for ${dataType} data to ${domain}. Include your name, address, and a clear statement requesting opt-out.`,
    follow_up: `Check if ${domain} has processed your opt-out request for ${dataType} data. If not, consider following up again.`,
    renewal: `It may be time to renew your opt-out for ${dataType} data on ${domain}.`,
  };

  const title = titles[reminderType] || `Privacy opt-out reminder — ${domain}`;
  const description = descriptions[reminderType] || `Opt-out reminder for ${dataType} on ${domain}`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Privacy Tool//Opt-Out Reminder//EN',
    'BEGIN:VEVENT',
    `DTSTART:${formatDate(eventDate)}`,
    `DTEND:${formatDate(new Date(eventDate.getTime() + 30 * 60 * 1000))}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${title}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function downloadIcsFile(icsContent: string, filename: string): void {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function isValidOptOutUrl(url: string): boolean {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return false;
  }
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function normalizeOptOutGuidance(analysis: Risk_Analysis): Risk_Analysis {
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
        🔗 <a href="${mechanism.value}" target="_blank" rel="noopener noreferrer" style="color: #1976D2; text-decoration: underline;">${mechanism.value}</a>
      </div>`;
      break;
    case 'email':
      html += `<div style="margin-top: 4px; font-size: 12px;">
        ✉️ <a href="mailto:${mechanism.value}" style="color: #1976D2; text-decoration: underline;">${mechanism.value}</a>
      </div>`;
      break;
    case 'account_steps':
      html += `<div style="margin-top: 4px; font-size: 12px;">📋 Steps:</div>`;
      html += '<ol style="margin: 4px 0 0 20px; padding: 0; font-size: 12px;">';
      const steps = mechanism.value.split('\n').filter(s => s.trim());
      for (const step of steps) {
        html += `<li style="margin-bottom: 2px;">${step.trim()}</li>`;
      }
      html += '</ol>';
      break;
    case 'postal_mail':
      html += `<div style="margin-top: 4px; font-size: 12px;">📬 ${mechanism.value}</div>`;
      break;
  }
  if (mechanism.instructionText) {
    html += `<div style="margin-top: 2px; font-size: 11px; color: #555; font-style: italic;">${mechanism.instructionText}</div>`;
  }
  return html;
}

function renderOptOutSection(
  guidance: OptOutGuidance,
  domain: string,
  dataType: string,
  actionRecords: ActionRecord[],
  reminders: ReminderMetadata[]
): string {
  let html = '<div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed #ddd;">';

  if (guidance.status === 'available') {
    html += '<div style="font-size: 12px; color: #4CAF50; font-weight: bold;">✅ Opt-out available</div>';
    for (const mechanism of guidance.mechanisms) {
      html += renderOptOutMechanism(mechanism);

      // Task 9.2: Render action buttons for available mechanisms
      if (mechanism.type === 'settings_url' || mechanism.type === 'web_form') {
        const btnId = `optout-btn-${dataType}-${mechanism.type}`;
        html += `<button class="privacy-tool-optout-btn" data-mechanism-type="${mechanism.type}" data-mechanism-url="${mechanism.value}" data-domain="${domain}" data-datatype="${dataType}" style="
          margin-top: 4px; padding: 4px 10px; background: #1976D2; color: white;
          border: none; border-radius: 3px; cursor: pointer; font-size: 11px;
        ">Opt Out</button>`;
      } else if (mechanism.type === 'email') {
        html += `<button class="privacy-tool-email-btn" data-mechanism-type="email" data-mechanism-email="${mechanism.value}" data-domain="${domain}" data-datatype="${dataType}" style="
          margin-top: 4px; padding: 4px 10px; background: #1976D2; color: white;
          border: none; border-radius: 3px; cursor: pointer; font-size: 11px;
        ">Send Opt-Out Email</button>`;
      } else if (mechanism.type === 'postal_mail') {
        html += `<button class="privacy-tool-reminder-btn" data-mechanism-type="postal_mail" data-domain="${domain}" data-datatype="${dataType}" style="
          margin-top: 4px; padding: 4px 10px; background: #FF9800; color: white;
          border: none; border-radius: 3px; cursor: pointer; font-size: 11px;
        ">📅 Add to Calendar (3 days)</button>`;
      }
    }
  } else if (guidance.status === 'vague') {
    html += '<div style="font-size: 12px; color: #FF9800; font-weight: bold;">⚠️ Vague opt-out language</div>';
    html += `<div style="font-size: 11px; color: #555; margin-top: 2px;">${guidance.summary}</div>`;
    if (guidance.warningNote) {
      html += `<div style="font-size: 11px; color: #FF9800; margin-top: 2px;">⚠ ${guidance.warningNote}</div>`;
    }
  } else {
    html += '<div style="font-size: 12px; color: #999;">❌ No opt-out option found in the policy for this data type.</div>';
  }

  html += '</div>';
  return html;
}

// ─── Analysis Results Display ─────────────────────────────────────────────────

async function showAnalysisResults(analysis: Risk_Analysis) {
  const overlay = document.getElementById('privacy-tool-alert-popup');
  if (!overlay) return;

  // Task 4.4: Legacy cache detection — check before normalization
  const isLegacyData = analysis.dataTypes.some(dt => dt.optOutGuidance === undefined);

  // Task 4.1: Normalize opt-out guidance for all entries
  const normalized = normalizeOptOutGuidance(analysis);

  // Task 9.1: Load tracking state from background
  let actionRecords: ActionRecord[] = [];
  let reminders: ReminderMetadata[] = [];
  try {
    const [actionsResp, remindersResp] = await Promise.all([
      new Promise<{ success: boolean; records?: ActionRecord[] }>((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'GET_ACTIONS', payload: { domain: normalized.targetDomain } },
          (resp) => resolve(resp ?? { success: false })
        );
      }),
      new Promise<{ success: boolean; reminders?: ReminderMetadata[] }>((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'GET_REMINDERS', payload: { domain: normalized.targetDomain } },
          (resp) => resolve(resp ?? { success: false })
        );
      }),
    ]);
    if (actionsResp.success && actionsResp.records) {
      actionRecords = actionsResp.records;
    }
    if (remindersResp.success && remindersResp.reminders) {
      reminders = remindersResp.reminders;
    }
  } catch {
    // Tracking state unavailable — render without it
  }

  const riskColors: Record<string, string> = {
    low: '#4CAF50',
    medium: '#FF9800',
    high: '#F44336',
  };

  const riskColor = riskColors[normalized.overallRiskLevel] || '#666';

  let html = `
    <button id="privacy-tool-close-btn" style="
      position: absolute; top: 8px; right: 8px;
      background: transparent; border: none; font-size: 20px; cursor: pointer; color: #999;
    ">×</button>
    <div style="font-weight: bold; margin-bottom: 8px;">🔒 Privacy Analysis Complete</div>
    <div style="margin-bottom: 12px;">
      <span style="font-weight: bold;">Overall Risk: </span>
      <span style="color: ${riskColor}; font-weight: bold; text-transform: uppercase;">${normalized.overallRiskLevel}</span>
    </div>
    <div style="margin-bottom: 8px; font-size: 12px; color: #666;">
      ${normalized.targetDomain} · ${normalized.dataTypes.length} data types found
    </div>
  `;

  // Policy summary gist at the top
  if (normalized.policySummary && normalized.policySummary.length > 0) {
    html += `
      <div style="margin-bottom: 10px; padding: 10px; background: #FFF8E1; border-radius: 4px; border-left: 3px solid #FF9800; font-size: 12px; color: #333; line-height: 1.5;">
        <div style="font-weight: bold; margin-bottom: 6px;">📋 Key Takeaways</div>
        <ul style="margin: 0; padding-left: 18px;">
          ${normalized.policySummary.map(point => `<li style="margin-bottom: 4px;">${point}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // Task 4.4: Legacy cache notice and re-analyze button
  if (isLegacyData) {
    html += `
      <div style="margin-bottom: 10px; padding: 8px; background: #E3F2FD; border-radius: 4px; font-size: 12px; color: #1565C0;">
        ℹ️ Opt-out information is not available for this analysis.
        <button id="privacy-tool-reanalyze-btn" style="
          display: block; margin-top: 6px; padding: 6px 12px;
          background: #1976D2; color: white; border: none; border-radius: 4px;
          cursor: pointer; font-size: 12px; font-weight: bold;
        ">Re-analyze with opt-out extraction</button>
      </div>
    `;
  }

  // Task 4.2: Opt-out summary section
  if (normalized.dataTypes.length > 0) {
    const availableCount = normalized.dataTypes.filter(dt => dt.optOutGuidance?.status === 'available').length;
    const vagueCount = normalized.dataTypes.filter(dt => dt.optOutGuidance?.status === 'vague').length;
    const unavailableCount = normalized.dataTypes.filter(dt => dt.optOutGuidance?.status === 'unavailable').length;

    html += `
      <div style="margin-bottom: 10px; padding: 8px; background: #FAFAFA; border-radius: 4px; font-size: 12px;">
        <div style="font-weight: bold; margin-bottom: 4px;">Opt-Out Summary</div>
        <div style="color: #4CAF50;">✅ ${availableCount} data type${availableCount !== 1 ? 's' : ''} with opt-out available</div>
        <div style="color: #FF9800;">⚠️ ${vagueCount} data type${vagueCount !== 1 ? 's' : ''} with vague opt-out language</div>
        <div style="color: #999;">❌ ${unavailableCount} data type${unavailableCount !== 1 ? 's' : ''} with no opt-out found</div>
      </div>
    `;
  }

  if (normalized.dataTypes.length > 0) {
    html += '<div style="max-height: 300px; overflow-y: auto;">';
    for (const dt of normalized.dataTypes) {
      const dtColor = riskColors[dt.riskLevel] || '#666';
      html += `
        <div style="margin-bottom: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px; border-left: 3px solid ${dtColor};">
          <div style="font-weight: bold; font-size: 13px;">${dt.dataType}
            <span style="color: ${dtColor}; font-size: 11px; text-transform: uppercase;"> ${dt.riskLevel}</span>
          </div>
          <div style="font-size: 12px; color: #555; margin-top: 4px;">
            ${dt.purposes.slice(0, 2).join(', ')}
          </div>
          ${dt.sharedWithThirdParties ? '<div style="font-size: 11px; color: #F44336; margin-top: 2px;">⚠ Shared with third parties</div>' : ''}
          ${dt.warningNote ? `<div style="font-size: 11px; color: #FF9800; margin-top: 2px;">⚠ ${dt.warningNote}</div>` : ''}
          ${dt.optOutGuidance ? renderOptOutSection(dt.optOutGuidance, normalized.targetDomain, dt.dataType, actionRecords, reminders) : ''}
        </div>
      `;
    }
    html += '</div>';
  } else {
    html += '<div style="color: #666; font-style: italic;">No personal data collection detected.</div>';
  }

  if (normalized.analysisWarnings.length > 0) {
    html += '<div style="margin-top: 8px; font-size: 11px; color: #999;">';
    for (const w of normalized.analysisWarnings) {
      html += `<div>⚠ ${w}</div>`;
    }
    html += '</div>';
  }

  html += `<div style="margin-top: 8px; font-size: 10px; color: #bbb;">Model: ${normalized.modelUsed}</div>`;

  overlay.innerHTML = html;
  overlay.style.maxHeight = '500px';
  overlay.style.overflowY = 'auto';

  // ─── Attach event listeners after innerHTML is set ──────────────────────────

  const closeBtn = document.getElementById('privacy-tool-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => overlay.remove());
  }

  // Task 4.4: Wire up re-analyze button
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

  // Task 9.5: Clear history — removed (no longer tracking completed actions)

  // "Set Reminder" button click handlers — downloads .ics file
  const reminderBtns = overlay.querySelectorAll('.privacy-tool-reminder-btn');
  for (const btn of reminderBtns) {
    btn.addEventListener('click', () => {
      const button = btn as HTMLButtonElement;
      const domain = button.getAttribute('data-domain') || '';
      const dataType = button.getAttribute('data-datatype') || '';

      const icsContent = buildIcsFile(domain, dataType, 'postal_mail', 3);
      const filename = `optout-reminder-${domain}-${dataType.replace(/\s+/g, '-')}.ics`;
      downloadIcsFile(icsContent, filename);

      button.textContent = '📅 Downloaded!';
      button.style.background = '#4CAF50';
      button.disabled = true;
    });
  }

  // Follow-up reminder buttons removed (no longer tracking completed actions)
  const optOutBtns = overlay.querySelectorAll('.privacy-tool-optout-btn');
  for (const btn of optOutBtns) {
    btn.addEventListener('click', () => {
      const button = btn as HTMLButtonElement;
      const url = button.getAttribute('data-mechanism-url') || '';
      const domain = button.getAttribute('data-domain') || '';
      const dataType = button.getAttribute('data-datatype') || '';
      const mechanismType = button.getAttribute('data-mechanism-type') as OptOutMechanismType;

      if (!isValidOptOutUrl(url)) {
        button.textContent = '⚠ Invalid link';
        button.style.background = '#F44336';
        setTimeout(() => {
          button.textContent = 'Opt Out';
          button.style.background = '#1976D2';
        }, 3000);
        return;
      }

      // Optimistic UI
      button.textContent = 'Opening...';
      button.disabled = true;

      chrome.runtime.sendMessage(
        { type: 'OPEN_TAB', payload: { url } },
        () => {
          chrome.runtime.sendMessage(
            {
              type: 'SAVE_ACTION',
              payload: {
                domain,
                dataType,
                mechanismType,
                action: 'opened_url' as const,
                timestamp: new Date().toISOString(),
              },
            },
            () => {
              button.textContent = '✅ Done';
              button.style.background = '#4CAF50';
            }
          );
        }
      );
    });
  }

  // Task 9.3: "Send Opt-Out Email" button click handlers
  const emailBtns = overlay.querySelectorAll('.privacy-tool-email-btn');
  for (const btn of emailBtns) {
    btn.addEventListener('click', () => {
      const button = btn as HTMLButtonElement;
      const email = button.getAttribute('data-mechanism-email') || '';
      const domain = button.getAttribute('data-domain') || '';
      const dataType = button.getAttribute('data-datatype') || '';

      // Optimistic UI
      button.textContent = 'Opening...';
      button.disabled = true;

      const mailtoLink = buildMailtoLink(email, domain, dataType);
      window.location.href = mailtoLink;

      chrome.runtime.sendMessage(
        {
          type: 'SAVE_ACTION',
          payload: {
            domain,
            dataType,
            mechanismType: 'email' as OptOutMechanismType,
            action: 'composed_email' as const,
            timestamp: new Date().toISOString(),
          },
        },
        () => {
          button.textContent = '✅ Done';
          button.style.background = '#4CAF50';
        }
      );
    });
  }

  // Old chrome.alarms handlers removed — using .ics download instead
}

function showAnalysisError(error: AnalysisErrorMessage['payload']) {
  const overlay = document.getElementById('privacy-tool-alert-popup');
  if (!overlay) return;

  let html = `
    <button id="privacy-tool-close-btn" style="
      position: absolute; top: 8px; right: 8px;
      background: transparent; border: none; font-size: 20px; cursor: pointer; color: #999;
    ">×</button>
    <div style="font-weight: bold; margin-bottom: 8px; color: #F44336;">❌ Analysis Failed</div>
    <div style="margin-bottom: 12px;">${error.message}</div>
  `;

  if (error.retryable) {
    html += `<button id="privacy-tool-retry-btn" style="
      width: 100%; padding: 10px; background: #FF9800; color: white;
      border: none; border-radius: 4px; cursor: pointer; font-weight: bold;
    ">Retry</button>`;
  }

  overlay.innerHTML = html;

  const closeBtn = document.getElementById('privacy-tool-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => overlay.remove());
  }
}
