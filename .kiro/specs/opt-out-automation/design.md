# Design Document: Opt-Out Automation

## Overview

This document describes the technical design for adding **opt-out automation, email pre-filling, reminders, and action tracking** to the Privacy Tool browser extension. The feature builds on the existing Opt-Out Guidance capability — which already extracts opt-out mechanisms per data type and renders them in the content script overlay — and adds four new capabilities on top:

1. **Auto-open opt-out URLs** — Action buttons that open `settings_url` and `web_form` mechanism URLs in a new tab via `chrome.tabs.create`
2. **Pre-filled opt-out emails** — Construct `mailto:` links with a templated subject and body for `email` mechanisms
3. **Reminder scheduling** — Use `chrome.alarms` + `chrome.notifications` for postal mail reminders, follow-up checks, and periodic renewal reminders
4. **Action tracking** — Persist `ActionRecord` objects in `chrome.storage.local` per domain, display progress indicators in the UI

The design introduces two new modules (`action_tracker.ts`, `reminder_scheduler.ts`), a new email template builder function, new message types for background communication, and UI extensions to the content script. No new npm dependencies are added — only Chrome platform APIs (`chrome.alarms`, `chrome.notifications`, `chrome.tabs`).

```
┌──────────────────────────────────────────────────────────────────────┐
│  Content Script (content_script.ts)                                  │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ Risk_Breakdown Panel                                         │    │
│  │  ┌─────────────────────────────────────────────────────────┐ │    │
│  │  │ Per-DataType Card                                       │ │    │
│  │  │  [Opt Out] [Send Email] [Set Reminder]  ← action btns  │ │    │
│  │  │  ✅ Opened URL — 2024-01-15            ← tracking      │ │    │
│  │  └─────────────────────────────────────────────────────────┘ │    │
│  │  Progress: 3/5 opt-out actions completed                     │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                          │                                           │
│          chrome.runtime.sendMessage                                  │
│                          ▼                                           │
├──────────────────────────────────────────────────────────────────────┤
│  Background Service Worker (background.ts)                           │
│  ┌────────────────────┐  ┌──────────────────────┐                   │
│  │ action_tracker.ts  │  │ reminder_scheduler.ts │                   │
│  │ saveAction()       │  │ scheduleReminder()    │                   │
│  │ getActions()       │  │ cancelReminder()      │                   │
│  │ clearActions()     │  │ getReminders()        │                   │
│  └────────┬───────────┘  └──────────┬───────────┘                   │
│           │                         │                                │
│    chrome.storage.local      chrome.alarms                           │
│                              chrome.notifications                    │
└──────────────────────────────────────────────────────────────────────┘
```

**Constraints carried forward:**
- Manifest V3 service worker — no DOM APIs in background
- Background bundle is ~32KB — no new npm dependencies
- Manual JSON validation (no Ajv — `eval` violates MV3 CSP)
- `chrome.storage.local` for all persistence
- Content script renders all UI; background handles scheduling and notifications

---

## Architecture

The feature adds two new modules to the background service worker and extends the content script UI. The existing pipeline (detect → fetch → parse → analyze → display) is unchanged — automation operates on the *output* of that pipeline.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  NEW: src/action_tracker.ts                                             │
│  saveActionRecord(record) → chrome.storage.local                        │
│  getActionRecords(domain) → ActionRecord[]                              │
│  clearActionRecords(domain) → void                                      │
│  Validates uniqueness of record IDs within a domain                     │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  NEW: src/reminder_scheduler.ts                                         │
│  scheduleReminder(metadata) → chrome.alarms.create                      │
│  cancelReminder(alarmName) → chrome.alarms.clear                        │
│  getReminders(domain) → ReminderMetadata[]                              │
│  handleAlarmFired(alarm) → chrome.notifications.create                  │
│  buildAlarmName(domain, dataType, reminderType) → string                │
│  Registers chrome.alarms.onAlarm + chrome.notifications.onClicked       │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  EXTENDED: src/background.ts                                            │
│  + handleScheduleReminder(message)                                      │
│  + handleCancelReminder(message)                                        │
│  + handleGetReminders(message)                                          │
│  + handleSaveAction(message)                                            │
│  + handleGetActions(message)                                            │
│  + handleClearActions(message)                                          │
│  + handleOpenTab(message)                                               │
│  + Alarm and notification listener registration at top level            │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  EXTENDED: src/content_script.ts                                        │
│  + renderActionButtons() — Opt Out, Send Email, Set Reminder buttons    │
│  + renderTrackingIndicators() — checkmarks + timestamps for completed   │
│  + renderProgressSummary() — X/Y actions completed                      │
│  + buildMailtoLink() — email template construction                      │
│  + loadTrackingState() — fetch ActionRecords + Reminders on panel open  │
│  + Button click handlers → sendMessage to background                    │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  EXTENDED: src/types.ts                                                 │
│  + ActionRecord interface                                               │
│  + ReminderMetadata interface                                           │
│  + ReminderType type                                                    │
│  + ActionType type                                                      │
│  + New message types (7 new messages added to ExtensionMessage union)   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  UPDATED: manifest.json                                                 │
│  permissions: ["storage", "activeTab", "alarms", "notifications"]       │
└─────────────────────────────────────────────────────────────────────────┘
```

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| New modules vs. inline in background.ts | Separate `action_tracker.ts` and `reminder_scheduler.ts` | Keeps background.ts focused on message routing; modules are testable in isolation |
| Email template in content script vs. background | Content script (`buildMailtoLink`) | No Chrome API needed — pure string construction; avoids a round-trip message |
| URL opening via background message | `OPEN_TAB` message → `chrome.tabs.create` in background | Content scripts cannot use `chrome.tabs` API; `window.open` is unreliable in MV3 content scripts |
| Alarm name encoding | `optout__{domain}__{dataType}__{reminderType}` | Deterministic, parseable, enables duplicate detection and cancellation by name (Req 8.6) |
| Action record ID generation | `${domain}__${dataType}__${mechanismType}__${timestamp}` | Unique within a domain; deterministic enough for dedup; no crypto dependency needed |
| Storage key namespacing | `optOutActions_{domain}` and `optOutReminders_{domain}` | Matches requirements (Req 8.3, 8.4); enables per-domain retrieval and cleanup |
| No new npm dependencies | Use only Chrome platform APIs | Background bundle is ~32KB; `chrome.alarms` and `chrome.notifications` are built-in |
| Reminder metadata in storage | Duplicate alarm info in `chrome.storage.local` | `chrome.alarms.getAll()` doesn't store custom metadata (domain, dataType, reminderType); storage provides persistence across service worker restarts (Req 3.8) |

---

## Components and Interfaces

### 1. Type Extensions (`src/types.ts`)

#### New Types

```typescript
// ─── Opt-Out Automation Types ─────────────────────────────────────────────────

export type ActionType = 'opened_url' | 'composed_email' | 'reminder_set';

export type ReminderType = 'postal_mail' | 'follow_up' | 'renewal';

export interface ActionRecord {
  id: string;                          // Unique within domain: `${domain}__${dataType}__${mechanismType}__${timestamp}`
  domain: string;
  dataType: string;
  mechanismType: OptOutMechanismType;
  action: ActionType;
  timestamp: string;                   // ISO 8601
}

export interface ReminderMetadata {
  alarmName: string;                   // `optout__${domain}__${dataType}__${reminderType}`
  domain: string;
  dataType: string;
  reminderType: ReminderType;
  scheduledTime: string;               // ISO 8601
  delayMinutes: number;
}
```

#### New Message Types

```typescript
// ─── Opt-Out Automation Message Types ─────────────────────────────────────────

export interface OpenTabMessage {
  type: 'OPEN_TAB';
  payload: { url: string };
}

export interface SaveActionMessage {
  type: 'SAVE_ACTION';
  payload: Omit<ActionRecord, 'id'>;   // Background generates the ID
}

export interface SaveActionResultMessage {
  type: 'SAVE_ACTION_RESULT';
  payload: { success: boolean; record?: ActionRecord; error?: string };
}

export interface GetActionsMessage {
  type: 'GET_ACTIONS';
  payload: { domain: string };
}

export interface ClearActionsMessage {
  type: 'CLEAR_ACTIONS';
  payload: { domain: string };
}

export interface ScheduleReminderMessage {
  type: 'SCHEDULE_REMINDER';
  payload: {
    domain: string;
    dataType: string;
    reminderType: ReminderType;
    delayMinutes: number;
  };
}

export interface CancelReminderMessage {
  type: 'CANCEL_REMINDER';
  payload: { alarmName: string };
}

export interface GetRemindersMessage {
  type: 'GET_REMINDERS';
  payload: { domain: string };
}
```

The `ExtensionMessage` union is extended:

```typescript
export type ExtensionMessage =
  | PolicyDetectedMessage
  | ShowAlertPopupMessage
  | InitiateAnalysisMessage
  | AnalysisCompleteMessage
  | AnalysisErrorMessage
  | ValidateApiKeyMessage
  | ApiKeyValidationResultMessage
  | OpenTabMessage
  | SaveActionMessage
  | SaveActionResultMessage
  | GetActionsMessage
  | ClearActionsMessage
  | ScheduleReminderMessage
  | CancelReminderMessage
  | GetRemindersMessage;
```

### 2. Action Tracker Module (`src/action_tracker.ts`)

A pure-logic module that persists and retrieves `ActionRecord` objects in `chrome.storage.local`. All functions are async and operate on the storage key `optOutActions_{domain}`.

```typescript
// ─── Action Tracker ───────────────────────────────────────────────────────────

const STORAGE_PREFIX = 'optOutActions_';

function storageKey(domain: string): string {
  return `${STORAGE_PREFIX}${domain}`;
}

function generateActionId(record: Omit<ActionRecord, 'id'>): string {
  return `${record.domain}__${record.dataType}__${record.mechanismType}__${record.timestamp}`;
}

export async function saveActionRecord(
  record: Omit<ActionRecord, 'id'>
): Promise<ActionRecord> {
  const key = storageKey(record.domain);
  const result = await chrome.storage.local.get(key);
  const existing: ActionRecord[] = result[key] ?? [];

  const fullRecord: ActionRecord = {
    ...record,
    id: generateActionId(record),
  };

  // Validate uniqueness (Req 8.5)
  if (existing.some(r => r.id === fullRecord.id)) {
    return fullRecord; // Idempotent — return existing
  }

  existing.push(fullRecord);
  await chrome.storage.local.set({ [key]: existing });
  return fullRecord;
}

export async function getActionRecords(domain: string): Promise<ActionRecord[]> {
  const key = storageKey(domain);
  const result = await chrome.storage.local.get(key);
  return result[key] ?? [];
}

export async function clearActionRecords(domain: string): Promise<void> {
  const key = storageKey(domain);
  await chrome.storage.local.remove(key);
}
```

**Validation function** (used in tests and optionally at load time):

```typescript
export function validateActionRecord(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { valid: false, errors: ['ActionRecord must be an object'] };
  }
  const r = data as Record<string, unknown>;

  if (typeof r.id !== 'string' || r.id.length === 0) errors.push('id must be a non-empty string');
  if (typeof r.domain !== 'string' || r.domain.length === 0) errors.push('domain must be a non-empty string');
  if (typeof r.dataType !== 'string' || r.dataType.length === 0) errors.push('dataType must be a non-empty string');

  const validMechanismTypes = ['settings_url', 'email', 'web_form', 'account_steps', 'postal_mail'];
  if (typeof r.mechanismType !== 'string' || !validMechanismTypes.includes(r.mechanismType)) {
    errors.push('mechanismType must be a valid OptOutMechanismType');
  }

  const validActions = ['opened_url', 'composed_email', 'reminder_set'];
  if (typeof r.action !== 'string' || !validActions.includes(r.action)) {
    errors.push('action must be one of: opened_url, composed_email, reminder_set');
  }

  if (typeof r.timestamp !== 'string' || r.timestamp.length === 0) {
    errors.push('timestamp must be a non-empty ISO 8601 string');
  }

  return { valid: errors.length === 0, errors };
}
```

### 3. Reminder Scheduler Module (`src/reminder_scheduler.ts`)

Handles `chrome.alarms` creation/cancellation and `chrome.notifications` dispatch. Stores `ReminderMetadata` in `chrome.storage.local` for persistence across service worker restarts.

```typescript
// ─── Reminder Scheduler ───────────────────────────────────────────────────────

const REMINDER_PREFIX = 'optOutReminders_';
const ALARM_SEPARATOR = '__';

function reminderStorageKey(domain: string): string {
  return `${REMINDER_PREFIX}${domain}`;
}

export function buildAlarmName(
  domain: string,
  dataType: string,
  reminderType: ReminderType
): string {
  return `optout${ALARM_SEPARATOR}${domain}${ALARM_SEPARATOR}${dataType}${ALARM_SEPARATOR}${reminderType}`;
}

export function parseAlarmName(
  alarmName: string
): { domain: string; dataType: string; reminderType: ReminderType } | null {
  const parts = alarmName.split(ALARM_SEPARATOR);
  if (parts.length < 4 || parts[0] !== 'optout') return null;
  return {
    domain: parts[1],
    dataType: parts[2],
    reminderType: parts[3] as ReminderType,
  };
}

export async function scheduleReminder(params: {
  domain: string;
  dataType: string;
  reminderType: ReminderType;
  delayMinutes: number;
}): Promise<ReminderMetadata> {
  const alarmName = buildAlarmName(params.domain, params.dataType, params.reminderType);

  // Check for existing reminder with same alarm name (Req 3.9)
  const existing = await getReminders(params.domain);
  const duplicate = existing.find(r => r.alarmName === alarmName);
  if (duplicate) {
    return duplicate; // Return existing — caller can offer cancel/reschedule
  }

  // Create chrome alarm
  await chrome.alarms.create(alarmName, { delayInMinutes: params.delayMinutes });

  // Store metadata (Req 3.8)
  const metadata: ReminderMetadata = {
    alarmName,
    domain: params.domain,
    dataType: params.dataType,
    reminderType: params.reminderType,
    scheduledTime: new Date(Date.now() + params.delayMinutes * 60 * 1000).toISOString(),
    delayMinutes: params.delayMinutes,
  };

  const key = reminderStorageKey(params.domain);
  const result = await chrome.storage.local.get(key);
  const reminders: ReminderMetadata[] = result[key] ?? [];
  reminders.push(metadata);
  await chrome.storage.local.set({ [key]: reminders });

  return metadata;
}

export async function cancelReminder(alarmName: string): Promise<void> {
  // Clear the chrome alarm
  await chrome.alarms.clear(alarmName);

  // Remove from storage
  const parsed = parseAlarmName(alarmName);
  if (!parsed) return;

  const key = reminderStorageKey(parsed.domain);
  const result = await chrome.storage.local.get(key);
  const reminders: ReminderMetadata[] = result[key] ?? [];
  const filtered = reminders.filter(r => r.alarmName !== alarmName);
  await chrome.storage.local.set({ [key]: filtered });
}

export async function getReminders(domain: string): Promise<ReminderMetadata[]> {
  const key = reminderStorageKey(domain);
  const result = await chrome.storage.local.get(key);
  return result[key] ?? [];
}

export function handleAlarmFired(alarm: chrome.alarms.Alarm): void {
  const parsed = parseAlarmName(alarm.name);
  if (!parsed) return;

  const bodyMap: Record<ReminderType, string> = {
    postal_mail: `Reminder: Send your opt-out letter for "${parsed.dataType}" data to ${parsed.domain}.`,
    follow_up: `Follow-up: Check if ${parsed.domain} has processed your opt-out request for "${parsed.dataType}" data.`,
    renewal: `Renewal: It may be time to renew your opt-out for "${parsed.dataType}" data on ${parsed.domain}.`,
  };

  chrome.notifications.create(alarm.name, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `Privacy Tool — ${parsed.domain}`,
    message: bodyMap[parsed.reminderType],
  });
}
```

**Validation function** for `ReminderMetadata`:

```typescript
export function validateReminderMetadata(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { valid: false, errors: ['ReminderMetadata must be an object'] };
  }
  const r = data as Record<string, unknown>;

  if (typeof r.alarmName !== 'string' || r.alarmName.length === 0) errors.push('alarmName must be a non-empty string');
  if (typeof r.domain !== 'string' || r.domain.length === 0) errors.push('domain must be a non-empty string');
  if (typeof r.dataType !== 'string' || r.dataType.length === 0) errors.push('dataType must be a non-empty string');

  const validReminderTypes = ['postal_mail', 'follow_up', 'renewal'];
  if (typeof r.reminderType !== 'string' || !validReminderTypes.includes(r.reminderType)) {
    errors.push('reminderType must be one of: postal_mail, follow_up, renewal');
  }

  if (typeof r.scheduledTime !== 'string' || r.scheduledTime.length === 0) {
    errors.push('scheduledTime must be a non-empty ISO 8601 string');
  }

  if (typeof r.delayMinutes !== 'number' || r.delayMinutes <= 0) {
    errors.push('delayMinutes must be a positive number');
  }

  return { valid: errors.length === 0, errors };
}
```

### 4. Email Template Builder (`src/content_script.ts` — `buildMailtoLink`)

A pure function in the content script that constructs a `mailto:` URL with pre-filled subject and body. No Chrome API needed.

```typescript
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
```

### 5. Background Service Worker Extensions (`src/background.ts`)

The message handler is extended with new message types. Alarm and notification listeners are registered at the top level (outside any function) so they survive service worker restarts.

```typescript
// ─── Top-level listener registration (Req 5.3, 5.4) ──────────────────────────

import { handleAlarmFired } from './reminder_scheduler.js';

chrome.alarms.onAlarm.addListener(handleAlarmFired);

chrome.notifications.onClicked.addListener((notificationId: string) => {
  // Clear the notification when clicked
  chrome.notifications.clear(notificationId);
});

// ─── Extended message handler ─────────────────────────────────────────────────

// Inside chrome.runtime.onMessage.addListener:

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
```

### 6. Content Script UI Extensions (`src/content_script.ts`)

The existing `showAnalysisResults` function is extended to:

1. **Load tracking state** — On panel open, send `GET_ACTIONS` and `GET_REMINDERS` messages to background, then render indicators
2. **Render action buttons** — Per mechanism within each DataType card:
   - `settings_url` / `web_form`: "Opt Out" button → sends `OPEN_TAB` + `SAVE_ACTION`
   - `email`: "Send Opt-Out Email" button → opens `buildMailtoLink()` result + sends `SAVE_ACTION`
   - `postal_mail`: "Set Reminder" button → sends `SCHEDULE_REMINDER` + `SAVE_ACTION`
3. **Render tracking indicators** — Checkmark + timestamp next to mechanisms with existing `ActionRecord`
4. **Render follow-up reminder buttons** — After any completed action (opened URL, composed email), show "Set Follow-Up Reminder" button
5. **Render progress summary** — "3/5 opt-out actions completed" at top of opt-out section
6. **Handle duplicate reminders** — If a reminder already exists for the same domain/dataType/reminderType, show the scheduled date and offer cancel/reschedule (Req 3.9)
7. **Optimistic UI updates** — Button states change immediately on click (loading → done), before the background response arrives (Req 7.6)

#### Button State Machine

```
[idle] → click → [loading] → background response → [done] or [error]
```

- **idle**: Default state, button is clickable
- **loading**: Button text changes (e.g., "Opening..."), button is disabled
- **done**: Button shows checkmark + timestamp, button is disabled
- **error**: Button shows error message, button returns to idle after 3 seconds

### 7. Manifest Permission Updates

```json
{
  "permissions": ["storage", "activeTab", "alarms", "notifications"]
}
```

Adding `alarms` and `notifications` to the existing permissions array. No new host permissions or optional permissions needed.

---

## Data Models

### ActionRecord

```typescript
interface ActionRecord {
  id: string;                          // `${domain}__${dataType}__${mechanismType}__${timestamp}`
  domain: string;                      // e.g., "example.com"
  dataType: string;                    // e.g., "location data"
  mechanismType: OptOutMechanismType;  // e.g., "settings_url"
  action: ActionType;                  // "opened_url" | "composed_email" | "reminder_set"
  timestamp: string;                   // ISO 8601, e.g., "2024-01-15T10:30:00.000Z"
}
```

### ReminderMetadata

```typescript
interface ReminderMetadata {
  alarmName: string;                   // `optout__${domain}__${dataType}__${reminderType}`
  domain: string;                      // e.g., "example.com"
  dataType: string;                    // e.g., "browsing history"
  reminderType: ReminderType;          // "postal_mail" | "follow_up" | "renewal"
  scheduledTime: string;               // ISO 8601
  delayMinutes: number;                // e.g., 4320 (3 days), 20160 (14 days)
}
```

### Storage Key Schema

| Key Pattern | Value Type | Description |
|---|---|---|
| `optOutActions_{domain}` | `ActionRecord[]` | All action records for a domain |
| `optOutReminders_{domain}` | `ReminderMetadata[]` | All active reminder metadata for a domain |

### Alarm Name Encoding

Format: `optout__{domain}__{dataType}__{reminderType}`

The double-underscore separator (`__`) is chosen because domains use single dots/hyphens and data type names use spaces — making `__` unambiguous for splitting.

### Default Reminder Delays

| Reminder Type | Default Delay | Minutes |
|---|---|---|
| `postal_mail` | 3 days | 4320 |
| `follow_up` | 14 days | 20160 |
| `renewal` | 90 days | 129600 |

### Validation Invariants

| Invariant | Rule |
|---|---|
| `ActionRecord.id` | Unique within a domain's action list |
| `ActionRecord.action` | Must be one of: `opened_url`, `composed_email`, `reminder_set` |
| `ActionRecord.mechanismType` | Must be a valid `OptOutMechanismType` |
| `ActionRecord.timestamp` | Must be a non-empty ISO 8601 string |
| `ReminderMetadata.alarmName` | Must encode domain, dataType, and reminderType deterministically |
| `ReminderMetadata.delayMinutes` | Must be a positive number |
| `ReminderMetadata.reminderType` | Must be one of: `postal_mail`, `follow_up`, `renewal` |
| Alarm name round-trip | `parseAlarmName(buildAlarmName(d, dt, rt))` returns `{ domain: d, dataType: dt, reminderType: rt }` |
| ActionRecord round-trip | `JSON.parse(JSON.stringify(record))` deeply equals `record` |
| ReminderMetadata round-trip | `JSON.parse(JSON.stringify(metadata))` deeply equals `metadata` |
| Mailto link structure | `buildMailtoLink(email, domain, dataType)` starts with `mailto:{email}?subject=` and contains `encodeURIComponent`-encoded subject and body |



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Action Button Rendering by Mechanism Type

*For any* `Risk_Analysis` with `DataTypeEntry` items having `optOutGuidance` with `status: 'available'`, the rendered action buttons HTML SHALL contain: an "Opt Out" button for each mechanism of type `settings_url` or `web_form`; a "Send Opt-Out Email" button for each mechanism of type `email`; a "Set Reminder" button for each mechanism of type `postal_mail`. Mechanisms with `status` other than `'available'` SHALL NOT have action buttons rendered.

**Validates: Requirements 1.1, 2.1, 3.1, 7.1, 7.3**

### Property 2: Mailto Link Structural Correctness

*For any* valid email address, domain string, and data type string (including strings with special characters like `&`, `=`, spaces, and unicode), `buildMailtoLink(email, domain, dataType)` SHALL produce a string that: starts with `mailto:{email}?subject=`; contains the domain in the subject when decoded via `decodeURIComponent`; contains the data type in the body when decoded; contains a privacy regulation reference in the decoded body; and round-trips through `decodeURIComponent` without data loss for both subject and body.

**Validates: Requirements 2.2, 2.3, 2.7**

### Property 3: Alarm Name Round-Trip

*For any* valid domain string, data type string, and reminder type (`postal_mail`, `follow_up`, or `renewal`), `parseAlarmName(buildAlarmName(domain, dataType, reminderType))` SHALL return an object with `domain`, `dataType`, and `reminderType` fields that are exactly equal to the original input values.

**Validates: Requirements 3.2, 8.6**

### Property 4: Notification Content from Alarm

*For any* valid alarm name built from a domain, data type, and reminder type, when `handleAlarmFired` is called with an alarm of that name, the resulting `chrome.notifications.create` call SHALL include a title containing the domain and a message body containing the data type.

**Validates: Requirements 3.5**

### Property 5: ActionRecord Save/Retrieve Round-Trip

*For any* valid action parameters (domain, dataType, mechanismType, action, timestamp), saving an `ActionRecord` via `saveActionRecord` and then retrieving via `getActionRecords(domain)` SHALL return an array containing a record whose `domain`, `dataType`, `mechanismType`, `action`, and `timestamp` fields match the original input.

**Validates: Requirements 1.3, 2.5, 3.6, 4.1, 8.3**

### Property 6: Reminder Schedule/Retrieve Round-Trip

*For any* valid reminder parameters (domain, dataType, reminderType, delayMinutes), scheduling a reminder via `scheduleReminder` and then retrieving via `getReminders(domain)` SHALL return an array containing a `ReminderMetadata` object whose `domain`, `dataType`, `reminderType`, and `delayMinutes` fields match the original input, and whose `alarmName` equals `buildAlarmName(domain, dataType, reminderType)`.

**Validates: Requirements 3.8, 8.4**

### Property 7: Reminder Scheduling Idempotence

*For any* valid reminder parameters, calling `scheduleReminder` twice with the same domain, dataType, and reminderType SHALL result in `getReminders(domain)` returning exactly one entry for that combination — the second call returns the existing metadata without creating a duplicate.

**Validates: Requirements 3.9**

### Property 8: Tracking Indicator Rendering

*For any* set of `ActionRecord` objects for a domain, the rendered tracking indicators HTML SHALL contain a checkmark symbol and the record's timestamp string for each `ActionRecord` in the set.

**Validates: Requirements 4.3, 7.2**

### Property 9: Progress Summary Counts

*For any* `Risk_Analysis` with `DataTypeEntry` items having available opt-out mechanisms, and any set of `ActionRecord` objects for the same domain, the rendered progress summary SHALL display a completed count equal to the number of mechanisms that have a corresponding `ActionRecord`, and a total count equal to the total number of available opt-out mechanisms across all data types.

**Validates: Requirements 4.4**

### Property 10: ActionRecord Serialization Round-Trip

*For any* valid array of `ActionRecord` objects, serializing via `JSON.stringify` and deserializing via `JSON.parse` SHALL produce an array that is deeply equal to the original — all fields (`id`, `domain`, `dataType`, `mechanismType`, `action`, `timestamp`) are preserved without loss or mutation.

**Validates: Requirements 4.6**

### Property 11: ActionRecord Validation Accepts Valid and Rejects Invalid

*For any* valid `ActionRecord` (all fields present with correct types and values from the allowed sets), `validateActionRecord` SHALL return `{ valid: true, errors: [] }`. *For any* `ActionRecord`-shaped object with at least one invalid field (missing `id`, empty `domain`, invalid `mechanismType`, invalid `action`, or non-string `timestamp`), `validateActionRecord` SHALL return `{ valid: false }` with a non-empty `errors` array.

**Validates: Requirements 8.1**

### Property 12: ReminderMetadata Validation Accepts Valid and Rejects Invalid

*For any* valid `ReminderMetadata` (all fields present with correct types and values from the allowed sets), `validateReminderMetadata` SHALL return `{ valid: true, errors: [] }`. *For any* `ReminderMetadata`-shaped object with at least one invalid field (empty `alarmName`, invalid `reminderType`, non-positive `delayMinutes`, or non-string `scheduledTime`), `validateReminderMetadata` SHALL return `{ valid: false }` with a non-empty `errors` array.

**Validates: Requirements 8.2**

### Property 13: ActionRecord ID Uniqueness

*For any* sequence of `saveActionRecord` calls for the same domain (with varying dataType, mechanismType, action, and timestamp values), the resulting array from `getActionRecords(domain)` SHALL contain only unique `id` values — no two records share the same `id`.

**Validates: Requirements 8.5**

---

## Error Handling

### Error Scenarios

| Error | Detection Point | User-Facing Response | Recovery Path |
|---|---|---|---|
| Mechanism URL is empty or malformed | Content script, before sending `OPEN_TAB` | Inline error: "This opt-out link appears to be invalid" | Button returns to idle after 3 seconds |
| `chrome.tabs.create` fails | Background `OPEN_TAB` handler | Inline error: "Could not open the opt-out page" | Retry button |
| `chrome.alarms.create` fails | Background `SCHEDULE_REMINDER` handler | Inline error: "Could not schedule reminder" | Retry button |
| `chrome.storage.local` write fails (quota exceeded) | `saveActionRecord` or `scheduleReminder` | Inline error: "Could not save — storage may be full" | Suggest clearing old data |
| `chrome.notifications.create` fails | `handleAlarmFired` | Silent failure — logged to console | No user action needed; alarm metadata remains for retry |
| Malformed data in storage (corrupted ActionRecord array) | `getActionRecords` | Treat as empty array; log warning | Data is effectively reset for that domain |
| Duplicate reminder detected | `scheduleReminder` | Show existing reminder date with cancel/reschedule options | User can cancel or reschedule |

### Error Handling Strategy

1. **URL validation** — The content script validates mechanism URLs before sending `OPEN_TAB`. A URL is considered valid if it starts with `http://` or `https://` and can be parsed by the `URL` constructor. Invalid URLs show an inline error and do not trigger a background message.

2. **Optimistic UI with rollback** — Button states change immediately on click (Req 7.6). If the background response indicates failure, the button rolls back to idle state and shows an error message for 3 seconds.

3. **Storage resilience** — If `chrome.storage.local.get` returns malformed data (not an array), the module treats it as an empty array and logs a warning. This prevents a single corrupted entry from breaking the entire domain's tracking.

4. **No new error codes** — All errors are handled locally within the action tracker and reminder scheduler modules. They do not propagate through the existing `AnalysisError` system because they are user-action errors, not pipeline errors.

5. **Alarm persistence** — `chrome.alarms` survive service worker restarts natively. The `ReminderMetadata` in `chrome.storage.local` provides the additional context (domain, dataType, reminderType) that the alarm API doesn't store. If metadata is missing when an alarm fires, the notification uses a generic message.

---

## Testing Strategy

### Overview

The testing strategy uses the same dual approach as the existing codebase:
- **Unit tests** (Vitest): specific examples, edge cases, integration points, UI state changes
- **Property-based tests** (Vitest + fast-check): universal properties across generated inputs

PBT is appropriate for this feature because the core additions — action tracking, reminder scheduling, email template construction, alarm name encoding, validation, and UI rendering — are pure functions or have clear input/output behavior with meaningful input variation.

### Property-Based Tests

Each property test runs a minimum of **100 iterations** via fast-check's `fc.assert(fc.property(...))`.

Each test is tagged with a comment referencing the design property:
```
// Feature: opt-out-automation, Property N: <property text>
```

**Test library**: fast-check 3.21.0 (already installed)

#### Property 1: Action Button Rendering by Mechanism Type
```typescript
// Feature: opt-out-automation, Property 1: Action Button Rendering by Mechanism Type
fc.assert(fc.property(
  riskAnalysisWithMechanismsArbitrary(),
  (analysis) => {
    const html = renderActionButtons(analysis);
    return analysis.dataTypes.every(dt => {
      if (!dt.optOutGuidance || dt.optOutGuidance.status !== 'available') {
        // No action buttons for non-available mechanisms
        return true;
      }
      return dt.optOutGuidance.mechanisms.every(m => {
        if (m.type === 'settings_url' || m.type === 'web_form') {
          return html.includes('Opt Out');
        }
        if (m.type === 'email') {
          return html.includes('Send Opt-Out Email');
        }
        if (m.type === 'postal_mail') {
          return html.includes('Set Reminder');
        }
        return true;
      });
    });
  }
), { numRuns: 100 });
```

#### Property 2: Mailto Link Structural Correctness
```typescript
// Feature: opt-out-automation, Property 2: Mailto Link Structural Correctness
fc.assert(fc.property(
  fc.tuple(
    fc.emailAddress(),
    fc.stringOf(fc.char(), { minLength: 1, maxLength: 50 }),  // domain
    fc.stringOf(fc.fullUnicode(), { minLength: 1, maxLength: 100 })  // dataType
  ),
  ([email, domain, dataType]) => {
    const link = buildMailtoLink(email, domain, dataType);
    // Starts with mailto:
    if (!link.startsWith(`mailto:${email}?subject=`)) return false;
    // Extract and decode subject and body
    const queryPart = link.substring(link.indexOf('?') + 1);
    const params = new URLSearchParams(queryPart);
    const subject = params.get('subject') ?? '';
    const body = params.get('body') ?? '';
    // Subject contains domain
    if (!subject.includes(domain)) return false;
    // Body contains dataType and domain
    if (!body.includes(dataType)) return false;
    if (!body.includes(domain)) return false;
    // Body contains privacy regulation reference
    if (!body.toLowerCase().includes('privacy') && !body.toLowerCase().includes('gdpr') && !body.toLowerCase().includes('ccpa')) return false;
    return true;
  }
), { numRuns: 100 });
```

#### Property 3: Alarm Name Round-Trip
```typescript
// Feature: opt-out-automation, Property 3: Alarm Name Round-Trip
fc.assert(fc.property(
  fc.tuple(
    fc.stringOf(fc.char(), { minLength: 1, maxLength: 50 }),  // domain
    fc.stringOf(fc.char(), { minLength: 1, maxLength: 50 }),  // dataType
    fc.constantFrom('postal_mail', 'follow_up', 'renewal')    // reminderType
  ),
  ([domain, dataType, reminderType]) => {
    const alarmName = buildAlarmName(domain, dataType, reminderType);
    const parsed = parseAlarmName(alarmName);
    return parsed !== null &&
      parsed.domain === domain &&
      parsed.dataType === dataType &&
      parsed.reminderType === reminderType;
  }
), { numRuns: 100 });
```

#### Property 4: Notification Content from Alarm
```typescript
// Feature: opt-out-automation, Property 4: Notification Content from Alarm
fc.assert(fc.property(
  fc.tuple(
    fc.stringOf(fc.char(), { minLength: 1, maxLength: 50 }),
    fc.stringOf(fc.char(), { minLength: 1, maxLength: 50 }),
    fc.constantFrom('postal_mail', 'follow_up', 'renewal')
  ),
  ([domain, dataType, reminderType]) => {
    const alarmName = buildAlarmName(domain, dataType, reminderType);
    const notifications: Array<{ id: string; opts: chrome.notifications.NotificationOptions }> = [];
    // Mock chrome.notifications.create
    chrome.notifications.create = (id, opts) => { notifications.push({ id, opts }); return ''; };
    handleAlarmFired({ name: alarmName, scheduledTime: Date.now(), periodInMinutes: undefined });
    return notifications.length === 1 &&
      notifications[0].opts.title!.includes(domain) &&
      notifications[0].opts.message!.includes(dataType);
  }
), { numRuns: 100 });
```

#### Property 5: ActionRecord Save/Retrieve Round-Trip
```typescript
// Feature: opt-out-automation, Property 5: ActionRecord Save/Retrieve Round-Trip
fc.assert(fc.asyncProperty(
  validActionParamsArbitrary(),
  async (params) => {
    // Clear storage for domain
    await clearActionRecords(params.domain);
    // Save
    const saved = await saveActionRecord(params);
    // Retrieve
    const records = await getActionRecords(params.domain);
    const found = records.find(r => r.id === saved.id);
    return found !== undefined &&
      found.domain === params.domain &&
      found.dataType === params.dataType &&
      found.mechanismType === params.mechanismType &&
      found.action === params.action &&
      found.timestamp === params.timestamp;
  }
), { numRuns: 100 });
```

#### Property 6: Reminder Schedule/Retrieve Round-Trip
```typescript
// Feature: opt-out-automation, Property 6: Reminder Schedule/Retrieve Round-Trip
fc.assert(fc.asyncProperty(
  validReminderParamsArbitrary(),
  async (params) => {
    // Clear existing reminders
    const existing = await getReminders(params.domain);
    for (const r of existing) await cancelReminder(r.alarmName);
    // Schedule
    const metadata = await scheduleReminder(params);
    // Retrieve
    const reminders = await getReminders(params.domain);
    const found = reminders.find(r => r.alarmName === metadata.alarmName);
    return found !== undefined &&
      found.domain === params.domain &&
      found.dataType === params.dataType &&
      found.reminderType === params.reminderType &&
      found.delayMinutes === params.delayMinutes &&
      found.alarmName === buildAlarmName(params.domain, params.dataType, params.reminderType);
  }
), { numRuns: 100 });
```

#### Property 7: Reminder Scheduling Idempotence
```typescript
// Feature: opt-out-automation, Property 7: Reminder Scheduling Idempotence
fc.assert(fc.asyncProperty(
  validReminderParamsArbitrary(),
  async (params) => {
    // Clear existing
    const existing = await getReminders(params.domain);
    for (const r of existing) await cancelReminder(r.alarmName);
    // Schedule twice
    await scheduleReminder(params);
    await scheduleReminder(params);
    // Retrieve
    const reminders = await getReminders(params.domain);
    const matching = reminders.filter(r =>
      r.domain === params.domain &&
      r.dataType === params.dataType &&
      r.reminderType === params.reminderType
    );
    return matching.length === 1;
  }
), { numRuns: 100 });
```

#### Property 8: Tracking Indicator Rendering
```typescript
// Feature: opt-out-automation, Property 8: Tracking Indicator Rendering
fc.assert(fc.property(
  fc.array(validActionRecordArbitrary(), { minLength: 1, maxLength: 10 }),
  (records) => {
    const html = renderTrackingIndicators(records);
    return records.every(r =>
      html.includes('✅') && html.includes(r.timestamp)
    );
  }
), { numRuns: 100 });
```

#### Property 9: Progress Summary Counts
```typescript
// Feature: opt-out-automation, Property 9: Progress Summary Counts
fc.assert(fc.property(
  fc.tuple(
    riskAnalysisWithMechanismsArbitrary(),
    fc.array(validActionRecordArbitrary(), { minLength: 0, maxLength: 20 })
  ),
  ([analysis, records]) => {
    const totalMechanisms = analysis.dataTypes.reduce((sum, dt) => {
      if (dt.optOutGuidance?.status === 'available') {
        return sum + dt.optOutGuidance.mechanisms.length;
      }
      return sum;
    }, 0);
    const completedCount = computeProgressCounts(analysis, records).completed;
    return completedCount >= 0 && completedCount <= totalMechanisms;
  }
), { numRuns: 100 });
```

#### Property 10: ActionRecord Serialization Round-Trip
```typescript
// Feature: opt-out-automation, Property 10: ActionRecord Serialization Round-Trip
fc.assert(fc.property(
  fc.array(validActionRecordArbitrary(), { minLength: 0, maxLength: 20 }),
  (records) => {
    const json = JSON.stringify(records);
    const restored = JSON.parse(json);
    return deepEqual(records, restored);
  }
), { numRuns: 100 });
```

#### Property 11: ActionRecord Validation Accepts Valid and Rejects Invalid
```typescript
// Feature: opt-out-automation, Property 11: ActionRecord Validation
fc.assert(fc.property(
  validActionRecordArbitrary(),
  (record) => {
    const result = validateActionRecord(record);
    return result.valid && result.errors.length === 0;
  }
), { numRuns: 100 });

fc.assert(fc.property(
  malformedActionRecordArbitrary(),
  (record) => {
    const result = validateActionRecord(record);
    return !result.valid && result.errors.length > 0;
  }
), { numRuns: 100 });
```

#### Property 12: ReminderMetadata Validation Accepts Valid and Rejects Invalid
```typescript
// Feature: opt-out-automation, Property 12: ReminderMetadata Validation
fc.assert(fc.property(
  validReminderMetadataArbitrary(),
  (metadata) => {
    const result = validateReminderMetadata(metadata);
    return result.valid && result.errors.length === 0;
  }
), { numRuns: 100 });

fc.assert(fc.property(
  malformedReminderMetadataArbitrary(),
  (metadata) => {
    const result = validateReminderMetadata(metadata);
    return !result.valid && result.errors.length > 0;
  }
), { numRuns: 100 });
```

#### Property 13: ActionRecord ID Uniqueness
```typescript
// Feature: opt-out-automation, Property 13: ActionRecord ID Uniqueness
fc.assert(fc.asyncProperty(
  fc.array(validActionParamsArbitrary(), { minLength: 2, maxLength: 20 }),
  async (paramsList) => {
    const domain = paramsList[0].domain;
    await clearActionRecords(domain);
    // Save all with same domain
    for (const params of paramsList) {
      await saveActionRecord({ ...params, domain });
    }
    const records = await getActionRecords(domain);
    const ids = records.map(r => r.id);
    const uniqueIds = new Set(ids);
    return ids.length === uniqueIds.size;
  }
), { numRuns: 100 });
```

### Unit Tests

**Action Tracker (`tests/unit/action_tracker.test.ts`):**
- `saveActionRecord` stores record under correct storage key `optOutActions_{domain}` (Req 4.1, 8.3)
- `saveActionRecord` generates ID in expected format `domain__dataType__mechanismType__timestamp` (Req 8.1)
- `saveActionRecord` is idempotent — saving same record twice doesn't create duplicate (Req 8.5)
- `getActionRecords` returns empty array for domain with no records
- `getActionRecords` returns all saved records for a domain
- `clearActionRecords` removes all records for a domain (Req 4.5)
- `clearActionRecords` does not affect other domains
- `validateActionRecord` rejects record with missing `id` field
- `validateActionRecord` rejects record with invalid `mechanismType`
- `validateActionRecord` rejects record with invalid `action`

**Reminder Scheduler (`tests/unit/reminder_scheduler.test.ts`):**
- `scheduleReminder` calls `chrome.alarms.create` with correct alarm name and delay (Req 3.2)
- `scheduleReminder` stores metadata under correct storage key `optOutReminders_{domain}` (Req 8.4)
- `scheduleReminder` with postal_mail uses 4320 minutes delay (Req 3.1)
- `scheduleReminder` with follow_up uses 20160 minutes delay (Req 3.4)
- `cancelReminder` calls `chrome.alarms.clear` and removes metadata from storage (Req 6.4)
- `getReminders` returns empty array for domain with no reminders
- `handleAlarmFired` calls `chrome.notifications.create` with correct title and message (Req 3.5)
- `handleAlarmFired` ignores alarms with unparseable names
- `buildAlarmName` produces deterministic output for same inputs (Req 8.6)
- `parseAlarmName` returns null for non-optout alarm names
- Duplicate reminder detection returns existing metadata (Req 3.9)

**Email Template Builder (`tests/unit/email_template.test.ts`):**
- `buildMailtoLink` produces valid mailto URL starting with `mailto:` (Req 2.2)
- `buildMailtoLink` subject contains domain name (Req 2.2)
- `buildMailtoLink` body contains data type name (Req 2.3)
- `buildMailtoLink` body contains privacy regulation reference (Req 2.3)
- `buildMailtoLink` body contains confirmation request (Req 2.3)
- `buildMailtoLink` handles special characters in domain and data type (Req 2.7)
- `buildMailtoLink` handles unicode characters in data type (Req 2.7)

**Content Script UI (`tests/unit/content_script.test.ts` — extended):**
- Renders "Opt Out" button for settings_url mechanism with available status (Req 1.1)
- Renders "Send Opt-Out Email" button for email mechanism with available status (Req 2.1)
- Renders "Set Reminder" button for postal_mail mechanism (Req 3.1)
- Does not render action buttons for mechanisms with vague or unavailable status
- Renders "Set Follow-Up Reminder" button after completed action (Req 3.3)
- Renders checkmark and timestamp for completed actions (Req 4.3)
- Renders progress summary with correct completed/total counts (Req 4.4)
- Shows error message for empty/malformed mechanism URL (Req 1.5)
- Button shows "Done" state after URL is opened (Req 1.4)
- Button shows "Done" state after email is composed (Req 2.6)
- Button shows "Reminder Set" with date after reminder is scheduled (Req 3.7)
- Shows existing reminder date for duplicate reminder attempt (Req 3.9)
- Loads tracking state on panel open before user interaction (Req 7.5)
- Button state changes immediately on click (optimistic update) (Req 7.6)

**Background Message Routing (`tests/unit/background.test.ts` — extended):**
- Handles `OPEN_TAB` message by calling `chrome.tabs.create` (Req 1.2)
- Handles `SAVE_ACTION` message by calling `saveActionRecord` (Req 6.2)
- Handles `GET_ACTIONS` message by calling `getActionRecords` (Req 6.2)
- Handles `CLEAR_ACTIONS` message by calling `clearActionRecords` (Req 6.2)
- Handles `SCHEDULE_REMINDER` message by calling `scheduleReminder` (Req 6.3)
- Handles `CANCEL_REMINDER` message by calling `cancelReminder` (Req 6.4)
- Handles `GET_REMINDERS` message by calling `getReminders` (Req 6.5)
- Registers `chrome.alarms.onAlarm` listener at top level (Req 5.3)
- Registers `chrome.notifications.onClicked` listener at top level (Req 5.4)

**Manifest (`tests/smoke/manifest.test.ts`):**
- `manifest.json` permissions include "alarms" (Req 5.1)
- `manifest.json` permissions include "notifications" (Req 5.2)

### Test File Structure

```
tests/
├── unit/
│   ├── action_tracker.test.ts              (NEW — ActionRecord CRUD + validation)
│   ├── reminder_scheduler.test.ts          (NEW — alarm scheduling + notifications)
│   ├── email_template.test.ts              (NEW — mailto link construction)
│   ├── content_script.test.ts              (EXTENDED — action buttons, tracking UI)
│   └── background.test.ts                  (NEW — message routing for new types)
├── property/
│   ├── action_tracker.property.test.ts     (Properties 5, 10, 11, 13)
│   ├── reminder_scheduler.property.test.ts (Properties 3, 4, 6, 7, 12)
│   ├── email_template.property.test.ts     (Property 2)
│   └── ui_rendering.property.test.ts       (Properties 1, 8, 9)
├── integration/
├── smoke/
│   └── manifest.test.ts                    (Req 5.1, 5.2)
```
