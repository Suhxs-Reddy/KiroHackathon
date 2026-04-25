import {
  ExtensionMessage,
  PolicyDetectedMessage,
  InitiateAnalysisMessage,
  ValidateApiKeyMessage,
  Risk_Analysis,
  AnalysisError,
  HIBPBreach,
  FieldCategoryId,
} from './types.js';
import { fetchDocument, wrapManualText } from './fetcher.js';
import { parseDocument } from './parser/index.js';
import { analyzePolicy, testApiKey } from './ai_engine_client.js';

// ═══════════════════════════════════════════════════════════════════════════════
// HIBP Breach Data (from DataGuard)
// ═══════════════════════════════════════════════════════════════════════════════

const HIBP_URL = 'https://haveibeenpwned.com/api/v3/breaches';
const CACHE_KEY = 'hibp_breaches_cache';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

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
      headers: { 'User-Agent': 'DataGuard-Extension/0.1.0' },
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

// ─── Breach query helpers ─────────────────────────────────────────────────────

const CATEGORY_TO_DATA_CLASSES: Record<string, string[]> = {
  FINANCIAL:     ['Credit cards', 'Banking', 'Financial data', 'Payment histories'],
  GOVERNMENT_ID: ['Government issued IDs', 'Social security numbers', 'Passport numbers', "Driver's licenses"],
  AUTH:          ['Passwords', 'Password hints', 'Security questions and answers', 'Auth tokens'],
  IDENTITY:      ['Names', 'Dates of birth', 'Physical addresses', 'Geographic locations'],
  CONTACT:       ['Email addresses', 'Phone numbers'],
  SENSITIVE:     ['Health data', 'Biometric data', 'Medical records', 'Sexual orientations', 'Ethnicities'],
};

function getBreachesForDomain(allBreaches: HIBPBreach[], domain: string): HIBPBreach[] {
  const domainLower = domain.toLowerCase().replace(/^www\./, '');
  return allBreaches
    .filter(b => {
      const breachDomain = (b.Domain || '').toLowerCase().replace(/^www\./, '');
      return breachDomain === domainLower || breachDomain.endsWith('.' + domainLower);
    })
    .sort((a, b) => new Date(b.BreachDate).getTime() - new Date(a.BreachDate).getTime());
}

function getBreachesForCategories(allBreaches: HIBPBreach[], categories: FieldCategoryId[]): HIBPBreach[] {
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
    .slice(0, 5);
}

// ─── Breach watch: check bookmarked sites ────────────────────────────────────

const BOOKMARKS_KEY = 'dg_bookmarked_sites';
const NOTIFIED_KEY = 'dg_notified_breaches';

async function checkBookmarkedSitesForBreaches(allBreaches: HIBPBreach[]) {
  const [bookmarksResult, notifiedResult] = await Promise.all([
    new Promise<Record<string, any>>(r => chrome.storage.local.get([BOOKMARKS_KEY], r)),
    new Promise<Record<string, any>>(r => chrome.storage.local.get([NOTIFIED_KEY], r)),
  ]);

  const bookmarks = bookmarksResult[BOOKMARKS_KEY] || {};
  const notified = notifiedResult[NOTIFIED_KEY] || {};
  const domains = Object.keys(bookmarks);
  if (domains.length === 0) return;

  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);

  for (const domain of domains) {
    const matches = getBreachesForDomain(allBreaches, domain)
      .filter(b => new Date(b.BreachDate) >= fiveYearsAgo);

    if (matches.length === 0) continue;

    const newBreaches = matches.filter(b => !notified[`${domain}:${b.Name}`]);
    if (newBreaches.length === 0) continue;

    const latest = newBreaches[0];
    const dataClasses = (latest.DataClasses || []).slice(0, 3).join(', ');

    chrome.notifications.create(`breach-${domain}-${latest.Name}`, {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: `🛡 DataGuard — Breach detected on ${domain}`,
      message: `${latest.Name} (${latest.BreachDate.slice(0, 4)}): ${dataClasses || 'data exposed'}.`,
      priority: 2,
    });

    for (const b of newBreaches) {
      notified[`${domain}:${b.Name}`] = true;
    }
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

// ═══════════════════════════════════════════════════════════════════════════════
// Policy Analysis Pipeline (from backend)
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// Message Routing (merged)
// ═══════════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage | any, sender, sendResponse) => {

    // ─── DataGuard: Breach data messages ────────────────────────────────
    if (message.type === 'GET_BREACH_DATA') {
      const { domain, categories } = message;
      getBreaches().then(allBreaches => {
        const domainBreaches = getBreachesForDomain(allBreaches, domain);
        const categoryBreaches = getBreachesForCategories(allBreaches, categories || []);
        sendResponse({
          success: true,
          domainBreaches,
          categoryBreaches,
        });
      }).catch(err => {
        sendResponse({ success: false, error: (err as Error).message, domainBreaches: [], categoryBreaches: [] });
      });
      return true;
    }

    if (message.type === 'REFRESH_BREACH_CACHE') {
      fetchAndCacheBreachesWithWatch().then(data => {
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

    // ─── DataGuard: Page data request (forwarded to content script) ─────
    if (message.type === 'GET_PAGE_DATA') {
      // This is handled by the content script directly
      return false;
    }

    // ─── Backend: Policy analysis messages ──────────────────────────────
    if (message.type === 'POLICY_DETECTED') {
      handlePolicyDetected(message as PolicyDetectedMessage, sender).then(sendResponse);
      return true;
    }

    if (message.type === 'INITIATE_ANALYSIS') {
      handleInitiateAnalysis(message as InitiateAnalysisMessage, sender).then(sendResponse);
      return true;
    }

    if (message.type === 'VALIDATE_API_KEY') {
      handleValidateApiKey(message as ValidateApiKeyMessage).then(sendResponse);
      return true;
    }

    return false;
  }
);

async function handlePolicyDetected(
  message: PolicyDetectedMessage,
  sender: chrome.runtime.MessageSender
) {
  await chrome.storage.local.set({
    [`metadata_${message.payload.domain}`]: message.payload,
  });

  if (sender.tab?.id) {
    chrome.tabs.sendMessage(sender.tab.id, {
      type: 'SHOW_ALERT_POPUP',
      payload: {
        policyLinks: message.payload.detectedPolicyLinks,
        hasConsentDialog: message.payload.hasConsentDialog,
      },
    } as ExtensionMessage);
  }
}

async function handleInitiateAnalysis(
  message: InitiateAnalysisMessage,
  sender: chrome.runtime.MessageSender
) {
  try {
    const analysis = await runAnalysisPipeline(message.payload);

    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        type: 'ANALYSIS_COMPLETE',
        payload: analysis,
      } as ExtensionMessage);
    }

    return { success: true, analysis };
  } catch (error) {
    if (error instanceof AnalysisError) {
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'ANALYSIS_ERROR',
          payload: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            manualInputFallback: error.manualInputFallback,
          },
        } as ExtensionMessage);
      }

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

    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        type: 'ANALYSIS_ERROR',
        payload: {
          code: 'PARSE_ERROR',
          message: 'An unexpected error occurred.',
          retryable: true,
          manualInputFallback: true,
        },
      } as ExtensionMessage);
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
    await testApiKey(message.payload.apiKey, message.payload.adapterType);
    await saveApiKey(message.payload.apiKey, message.payload.adapterType);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof AnalysisError
      ? error.message
      : error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMsg };
  }
}

// ─── API Key Storage ──────────────────────────────────────────────────────────

async function saveApiKey(key: string, adapterType: 'saulm' | 'openai'): Promise<void> {
  await chrome.storage.local.set({ apiKey: key, adapterType });
}

export async function loadApiKey(): Promise<string | null> {
  const result = await chrome.storage.local.get('apiKey');
  return result.apiKey || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Lifecycle Events
// ═══════════════════════════════════════════════════════════════════════════════

// Pre-warm breach cache on install
chrome.runtime.onInstalled.addListener(() => {
  getBreaches();
});

// Weekly alarm for breach watch
chrome.alarms.create('weekly-breach-check', { periodInMinutes: 60 * 24 * 7 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'weekly-breach-check') {
    fetchAndCacheBreachesWithWatch();
  }
});
