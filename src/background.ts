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

// ─── Top-level listener registration (Req 5.3, 5.4) ──────────────────────────

chrome.alarms.onAlarm.addListener(handleAlarmFired);

chrome.notifications.onClicked.addListener((notificationId: string) => {
  chrome.notifications.clear(notificationId);
});

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
  (message: ExtensionMessage, sender, sendResponse) => {
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

    return false;
  }
);

async function handlePolicyDetected(
  message: PolicyDetectedMessage,
  sender: chrome.runtime.MessageSender
) {
  // Store metadata
  await chrome.storage.local.set({
    [`metadata_${message.payload.domain}`]: message.payload,
  });

  // Send SHOW_ALERT_POPUP back to content script
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

    // Send success message
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        type: 'ANALYSIS_COMPLETE',
        payload: analysis,
      } as ExtensionMessage);
    }

    return { success: true, analysis };
  } catch (error) {
    if (error instanceof AnalysisError) {
      // Send error message
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

    // Unknown error
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
