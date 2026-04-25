import {
  ExtensionMessage,
  PolicyDetectedMessage,
  InitiateAnalysisMessage,
  ValidateApiKeyMessage,
  Risk_Analysis,
  AnalysisError,
} from './types.js';
import { fetchDocument, wrapManualText } from './fetcher.js';
import { parseDocument } from './parser/index.js';
import { analyzePolicy, testApiKey } from './ai_engine_client.js';
import { handleAlarmFired } from './reminder_scheduler.js';
import { saveActionRecord, getActionRecords, clearActionRecords } from './action_tracker.js';
import { scheduleReminder, cancelReminder, getReminders } from './reminder_scheduler.js';

// ─── DataGuard: HIBP Breach Data Constants ────────────────────────────────────

const HIBP_URL = 'https://haveibeenpwned.com/api/v3/breaches';
const CACHE_KEY = 'hibp_breaches_cache';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

const BOOKMARKS_KEY = 'dg_bookmarked_sites';
const NOTIFIED_KEY = 'dg_notified_breaches';

/**
 * Map internal category IDs to HIBP DataClasses strings.
 */
const CATEGORY_TO_DATA_CLASSES: Record<string, string[]> = {
  FINANCIAL: ['Credit cards', 'Banking', 'Financial data', 'Payment histories'],
  GOVERNMENT_ID: ['Government issued IDs', 'Social security numbers', 'Passport numbers', "Driver's licenses"],
  AUTH: ['Passwords', 'Password hints', 'Security questions and answers', 'Auth tokens'],
  IDENTITY: ['Names', 'Dates of birth', 'Physical addresses', 'Geographic locations'],
  CONTACT: ['Email addresses', 'Phone numbers'],
  SENSITIVE: ['Health data', 'Biometric data', 'Medical records', 'Sexual orientations', 'Ethnicities'],
};

// ─── DataGuard: HIBP Cache Management ─────────────────────────────────────────

interface HIBPBreach {
  Name: string;
  Domain: string;
  BreachDate: string;
  DataClasses: string[];
  [key: string]: unknown;
}

async function getCachedBreaches(): Promise<HIBPBreach[] | null> {
  return new Promise(resolve => {
    chrome.storage.local.get([CACHE_KEY], result => {
      const cached = result[CACHE_KEY];
      if (cached && cached.timestamp && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
        resolve(cached.data);
      } else {
        resolve(null);
      }
    });
  });
}

async function fetchAndCacheBreaches(): Promise<HIBPBreach[]> {
  try {
    const response = await fetch(HIBP_URL, {
      headers: {
        'User-Agent': 'DataGuard-Extension/0.1.0',
      },
    });
    if (!response.ok) throw new Error(`HIBP API error: ${response.status}`);
    const data: HIBPBreach[] = await response.json();
    await new Promise<void>(resolve => {
      chrome.storage.local.set({
        [CACHE_KEY]: { data, timestamp: Date.now() },
      }, resolve);
    });
    return data;
  } catch (err) {
    console.warn('[DataGuard] Failed to fetch HIBP data:', (err as Error).message);
    return [];
  }
}

async function getBreaches(): Promise<HIBPBreach[]> {
  const cached = await getCachedBreaches();
  if (cached) return cached;
  return fetchAndCacheBreaches();
}

// ─── DataGuard: Breach Query Helpers ──────────────────────────────────────────

function getBreachesForDomain(allBreaches: HIBPBreach[], domain: string): HIBPBreach[] {
  const domainLower = domain.toLowerCase().replace(/^www\./, '');
  return allBreaches
    .filter(b => {
      const breachDomain = (b.Domain || '').toLowerCase().replace(/^www\./, '');
      return breachDomain === domainLower || breachDomain.endsWith('.' + domainLower);
    })
    .sort((a, b) => new Date(b.BreachDate).getTime() - new Date(a.BreachDate).getTime());
}

function getBreachesForCategories(allBreaches: HIBPBreach[], categories: string[]): HIBPBreach[] {
  const relevantClasses = new Set<string>();
  for (const cat of categories) {
    const classes = CATEGORY_TO_DATA_CLASSES[cat] || [];
    classes.forEach(c => relevantClasses.add(c.toLowerCase()));
  }

  return allBreaches
    .filter(b => {
      const dataClasses = (b.DataClasses || []).map(d => d.toLowerCase());
      return dataClasses.some(dc => [...relevantClasses].some(rc => dc.includes(rc) || rc.includes(dc)));
    })
    .sort((a, b) => new Date(b.BreachDate).getTime() - new Date(a.BreachDate).getTime())
    .slice(0, 5); // top 5 most recent
}

// ─── DataGuard: Breach Watch for Bookmarked Sites ─────────────────────────────

async function checkBookmarkedSitesForBreaches(allBreaches: HIBPBreach[]): Promise<void> {
  const [bookmarksResult, notifiedResult] = await Promise.all([
    new Promise<Record<string, unknown>>(r => chrome.storage.local.get([BOOKMARKS_KEY], r)),
    new Promise<Record<string, unknown>>(r => chrome.storage.local.get([NOTIFIED_KEY], r)),
  ]);

  const bookmarks = (bookmarksResult[BOOKMARKS_KEY] || {}) as Record<string, { lastChecked?: string }>;
  const notified = (notifiedResult[NOTIFIED_KEY] || {}) as Record<string, boolean>;
  const domains = Object.keys(bookmarks);
  if (domains.length === 0) return;

  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);

  for (const domain of domains) {
    const matches = getBreachesForDomain(allBreaches, domain)
      .filter(b => new Date(b.BreachDate) >= fiveYearsAgo);

    if (matches.length === 0) continue;

    // Only notify about breaches we haven't already notified for
    const newBreaches = matches.filter(b => !notified[`${domain}:${b.Name}`]);
    if (newBreaches.length === 0) continue;

    const latest = newBreaches[0];
    const dataClasses = (latest.DataClasses || []).slice(0, 3).join(', ');

    chrome.notifications.create(`breach-${domain}-${latest.Name}`, {
      type: 'basic',
      iconUrl: 'DataGuard/icons/icon48.png',
      title: `🛡 DataGuard — Breach detected on ${domain}`,
      message: `${latest.Name} (${latest.BreachDate.slice(0, 4)}): ${dataClasses || 'data exposed'}.`,
      priority: 2,
    });

    // Mark as notified
    for (const b of newBreaches) {
      notified[`${domain}:${b.Name}`] = true;
    }

    // Update lastChecked on bookmark
    bookmarks[domain].lastChecked = new Date().toISOString();
  }

  await Promise.all([
    new Promise<void>(r => chrome.storage.local.set({ [NOTIFIED_KEY]: notified }, r)),
    new Promise<void>(r => chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks }, r)),
  ]);
}

async function fetchAndCacheBreachesWithWatch(): Promise<HIBPBreach[]> {
  const data = await fetchAndCacheBreaches();
  if (data.length > 0) {
    checkBookmarkedSitesForBreaches(data).catch(console.warn);
  }
  return data;
}

// ─── Top-level listener registration (Req 5.3, 5.4) ──────────────────────────

// Unified alarm handler: routes to opt-out reminders OR weekly breach check
chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
  if (alarm.name === 'weekly-breach-check') {
    fetchAndCacheBreachesWithWatch();
  } else {
    // Delegate to the opt-out reminder handler
    handleAlarmFired(alarm);
  }
});

chrome.notifications.onClicked.addListener((notificationId: string) => {
  chrome.notifications.clear(notificationId);
});

// ─── DataGuard: Pre-warm cache and set up weekly alarm ────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  getBreaches();
});

chrome.alarms.create('weekly-breach-check', { periodInMinutes: 60 * 24 * 7 });

// ─── Task 7.1: Pipeline Orchestration ─────────────────────────────────────────

async function runAnalysisPipeline(
  input: { policyUrl: string } | { manualText: string }
): Promise<Risk_Analysis> {
  // Step 1: Fetch
  const rawDoc = 'policyUrl' in input
    ? await fetchDocument(input.policyUrl)
    : wrapManualText(input.manualText);

  // Step 2: Parse
  const parsed = await parseDocument(rawDoc);

  // Step 3: AI Analyze
  const analysis = await analyzePolicy(parsed);

  // Step 4: Cache
  const cacheKey = 'policyUrl' in input ? input.policyUrl : 'manual';
  await chrome.storage.local.set({ [cacheKey]: analysis });

  return analysis;
}

// ─── Task 7.2: Message Routing ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (message: ExtensionMessage | { type: string; payload?: any }, sender, sendResponse) => {
    if (message.type === 'POLICY_DETECTED') {
      handlePolicyDetected(message, sender).then(sendResponse);
      return true; // Keep channel open for async response
    }

    if (message.type === 'INITIATE_ANALYSIS') {
      handleInitiateAnalysis(message, sender).then(sendResponse);
      return true;
    }

    if (message.type === 'VALIDATE_API_KEY') {
      handleValidateApiKey(message).then(sendResponse);
      return true;
    }

    // ─── Opt-Out Automation Message Handlers ────────────────────────────────

    if (message.type === 'OPEN_TAB') {
      chrome.tabs.create({ url: message.payload.url });
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'SAVE_ACTION') {
      saveActionRecord(message.payload).then(record => {
        sendResponse({ success: true, record });
      });
      return true;
    }

    if (message.type === 'GET_ACTIONS') {
      getActionRecords(message.payload.domain).then(records => {
        sendResponse({ success: true, records });
      });
      return true;
    }

    if (message.type === 'CLEAR_ACTIONS') {
      clearActionRecords(message.payload.domain).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }

    if (message.type === 'SCHEDULE_REMINDER') {
      scheduleReminder(message.payload).then(metadata => {
        sendResponse({ success: true, metadata });
      });
      return true;
    }

    if (message.type === 'CANCEL_REMINDER') {
      cancelReminder(message.payload.alarmName).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }

    if (message.type === 'GET_REMINDERS') {
      getReminders(message.payload.domain).then(reminders => {
        sendResponse({ success: true, reminders });
      });
      return true;
    }

    // ─── DataGuard: Breach Data Message Handlers ──────────────────────────────

    if (message.type === 'GET_BREACH_DATA') {
      const { domain, categories } = message.payload as { domain: string; categories?: string[] };
      getBreaches().then(allBreaches => {
        const domainBreaches = getBreachesForDomain(allBreaches, domain);
        const categoryBreaches = getBreachesForCategories(allBreaches, categories || []);
        sendResponse({
          success: true,
          domainBreaches,
          categoryBreaches,
          cacheAge: null,
        });
      }).catch(err => {
        sendResponse({ success: false, error: (err as Error).message, domainBreaches: [], categoryBreaches: [] });
      });
      return true;
    }

    if (message.type === 'REFRESH_BREACH_CACHE') {
      fetchAndCacheBreaches().then(data => {
        sendResponse({ success: true, count: data.length });
      }).catch(err => {
        sendResponse({ success: false, error: (err as Error).message });
      });
      return true;
    }

    if (message.type === 'GET_CACHE_STATUS') {
      chrome.storage.local.get([CACHE_KEY], result => {
        const cached = result[CACHE_KEY];
        if (cached && cached.timestamp) {
          const ageMs = Date.now() - cached.timestamp;
          const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
          sendResponse({
            hasCachedData: true,
            count: cached.data ? cached.data.length : 0,
            ageDays,
            isStale: ageMs >= CACHE_TTL_MS,
          });
        } else {
          sendResponse({ hasCachedData: false, count: 0, ageDays: null, isStale: true });
        }
      });
      return true;
    }

    return false;
  }
);

async function handlePolicyDetected(
  message: PolicyDetectedMessage,
  _sender: chrome.runtime.MessageSender
) {
  // Store metadata — the popup reads this to find policy URLs
  await chrome.storage.local.set({
    [`metadata_${message.payload.domain}`]: message.payload,
  });

  // Note: No longer sending SHOW_ALERT_POPUP back to content script.
  // The DataGuard popup handles all UI rendering now.
}

async function handleInitiateAnalysis(
  message: InitiateAnalysisMessage,
  _sender: chrome.runtime.MessageSender
) {
  try {
    const analysis = await runAnalysisPipeline(message.payload);
    return { success: true, analysis };
  } catch (error) {
    if (error instanceof AnalysisError) {
      return {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          manualInputFallback: error.manualInputFallback,
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'PARSE_ERROR',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        manualInputFallback: true,
      },
    };
  }
}

async function handleValidateApiKey(message: ValidateApiKeyMessage) {
  try {
    console.log('[background] Validating API key for', message.payload.adapterType);
    await testApiKey(message.payload.apiKey, message.payload.adapterType);

    // Save API key on success
    await saveApiKey(message.payload.apiKey, message.payload.adapterType);
    console.log('[background] API key validated and saved');

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof AnalysisError
      ? error.message
      : error instanceof Error ? error.message : String(error);
    console.error('[background] API key validation failed:', errorMsg);

    return {
      success: false,
      error: errorMsg,
    };
  }
}

// ─── Task 8.1: Encrypted API Key Storage ──────────────────────────────────────

async function saveApiKey(key: string, adapterType: 'saulm' | 'openai'): Promise<void> {
  // For now, store plaintext (encryption would require Web Crypto API setup)
  // In production, use chrome.storage.session with encryption
  await chrome.storage.local.set({
    apiKey: key,
    adapterType,
  });
}

export async function loadApiKey(): Promise<string | null> {
  const result = await chrome.storage.local.get('apiKey');
  return result.apiKey || null;
}
