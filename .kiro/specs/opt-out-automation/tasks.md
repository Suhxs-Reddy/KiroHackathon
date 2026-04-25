# Implementation Plan: Opt-Out Automation

## Overview

This plan implements opt-out automation for the Privacy Tool browser extension, building on the existing opt-out guidance capability. The implementation adds four capabilities: auto-open opt-out URLs, pre-filled opt-out emails, reminder scheduling via `chrome.alarms`/`chrome.notifications`, and action tracking via `chrome.storage.local`. Two new modules (`action_tracker.ts`, `reminder_scheduler.ts`) are introduced alongside extensions to `types.ts`, `background.ts`, `content_script.ts`, and `manifest.json`. No new npm dependencies are added.

## Tasks

- [x] 1. Add new types and message definitions to `src/types.ts`
  - Add `ActionType`, `ReminderType` type aliases
  - Add `ActionRecord` and `ReminderMetadata` interfaces
  - Add 8 new message interfaces: `OpenTabMessage`, `SaveActionMessage`, `SaveActionResultMessage`, `GetActionsMessage`, `ClearActionsMessage`, `ScheduleReminderMessage`, `CancelReminderMessage`, `GetRemindersMessage`
  - Extend the `ExtensionMessage` union type with all new message types
  - _Requirements: 8.1, 8.2_

- [ ] 2. Implement Action Tracker module (`src/action_tracker.ts`)
  - [x] 2.1 Create `src/action_tracker.ts` with core CRUD functions
    - Implement `storageKey(domain)` helper returning `optOutActions_{domain}`
    - Implement `generateActionId(record)` returning `${domain}__${dataType}__${mechanismType}__${timestamp}`
    - Implement `saveActionRecord(record)` — reads existing records from storage, checks ID uniqueness, appends, and writes back; idempotent for duplicate IDs
    - Implement `getActionRecords(domain)` — reads from storage, returns array or empty array for missing/malformed data
    - Implement `clearActionRecords(domain)` — removes the storage key for the domain
    - Implement `validateActionRecord(data)` — validates all fields with type and value checks, returns `{ valid, errors }`
    - _Requirements: 4.1, 4.5, 8.1, 8.3, 8.5_

  - [ ]* 2.2 Write unit tests for Action Tracker
    - Test `saveActionRecord` stores under correct key `optOutActions_{domain}`
    - Test `saveActionRecord` generates ID in expected format
    - Test `saveActionRecord` is idempotent for duplicate records
    - Test `getActionRecords` returns empty array for unknown domain
    - Test `getActionRecords` returns all saved records
    - Test `clearActionRecords` removes records for domain without affecting others
    - Test `validateActionRecord` rejects missing `id`, invalid `mechanismType`, invalid `action`
    - _Requirements: 4.1, 4.5, 8.1, 8.3, 8.5_

  - [ ]* 2.3 Write property tests for Action Tracker
    - **Property 5: ActionRecord Save/Retrieve Round-Trip**
    - **Property 10: ActionRecord Serialization Round-Trip**
    - **Property 11: ActionRecord Validation Accepts Valid and Rejects Invalid**
    - **Property 13: ActionRecord ID Uniqueness**
    - **Validates: Requirements 1.3, 2.5, 3.6, 4.1, 4.6, 8.1, 8.3, 8.5**

- [ ] 3. Implement Reminder Scheduler module (`src/reminder_scheduler.ts`)
  - [x] 3.1 Create `src/reminder_scheduler.ts` with scheduling functions
    - Implement `reminderStorageKey(domain)` helper returning `optOutReminders_{domain}`
    - Implement `buildAlarmName(domain, dataType, reminderType)` returning `optout__${domain}__${dataType}__${reminderType}`
    - Implement `parseAlarmName(alarmName)` — splits on `__`, validates prefix, returns parsed object or null
    - Implement `scheduleReminder(params)` — checks for duplicate via `getReminders`, creates `chrome.alarms.create`, stores `ReminderMetadata` in storage; returns existing metadata if duplicate found
    - Implement `cancelReminder(alarmName)` — calls `chrome.alarms.clear`, removes metadata from storage
    - Implement `getReminders(domain)` — reads from storage, returns array or empty array
    - Implement `handleAlarmFired(alarm)` — parses alarm name, creates `chrome.notifications.create` with title containing domain and message containing data type and reminder-type-specific body text
    - Implement `validateReminderMetadata(data)` — validates all fields with type and value checks
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.8, 3.9, 5.3, 6.1, 6.6, 8.2, 8.4, 8.6_

  - [ ]* 3.2 Write unit tests for Reminder Scheduler
    - Test `scheduleReminder` calls `chrome.alarms.create` with correct alarm name and delay
    - Test `scheduleReminder` stores metadata under `optOutReminders_{domain}`
    - Test `scheduleReminder` with postal_mail uses 4320 minutes, follow_up uses 20160 minutes
    - Test `cancelReminder` calls `chrome.alarms.clear` and removes metadata
    - Test `getReminders` returns empty array for unknown domain
    - Test `handleAlarmFired` calls `chrome.notifications.create` with correct title and message
    - Test `handleAlarmFired` ignores alarms with unparseable names
    - Test `buildAlarmName` is deterministic for same inputs
    - Test `parseAlarmName` returns null for non-optout alarm names
    - Test duplicate reminder detection returns existing metadata
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.8, 3.9, 5.3, 6.4, 6.5, 8.4, 8.6_

  - [ ]* 3.3 Write property tests for Reminder Scheduler
    - **Property 3: Alarm Name Round-Trip**
    - **Property 4: Notification Content from Alarm**
    - **Property 6: Reminder Schedule/Retrieve Round-Trip**
    - **Property 7: Reminder Scheduling Idempotence**
    - **Property 12: ReminderMetadata Validation Accepts Valid and Rejects Invalid**
    - **Validates: Requirements 3.2, 3.5, 3.8, 3.9, 8.2, 8.4, 8.6**

- [ ] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement email template builder and URL validation in content script
  - [x] 5.1 Add `buildMailtoLink` function to `src/content_script.ts`
    - Implement `buildMailtoLink(emailAddress, domain, dataType)` as a pure function
    - Construct subject line: `Data Opt-Out Request — ${domain}`
    - Construct body with greeting, identification, opt-out request, privacy regulation reference (GDPR, CCPA), confirmation request, and closing
    - Encode subject and body with `encodeURIComponent`
    - Return `mailto:${emailAddress}?subject=...&body=...`
    - _Requirements: 2.2, 2.3, 2.7_

  - [x] 5.2 Add URL validation helper to `src/content_script.ts`
    - Implement `isValidOptOutUrl(url)` — checks URL starts with `http://` or `https://` and is parseable by `URL` constructor
    - Used by action button click handlers to gate `OPEN_TAB` messages
    - _Requirements: 1.5_

  - [ ]* 5.3 Write unit tests for email template builder
    - Test `buildMailtoLink` produces valid mailto URL
    - Test subject contains domain name
    - Test body contains data type, domain, privacy regulation reference, confirmation request
    - Test special characters in domain and data type are properly encoded
    - Test unicode characters in data type
    - _Requirements: 2.2, 2.3, 2.7_

  - [ ]* 5.4 Write property test for email template builder
    - **Property 2: Mailto Link Structural Correctness**
    - **Validates: Requirements 2.2, 2.3, 2.7**

- [ ] 6. Extend background service worker with new message handlers
  - [x] 6.1 Add top-level alarm and notification listeners to `src/background.ts`
    - Import `handleAlarmFired` from `./reminder_scheduler.js`
    - Register `chrome.alarms.onAlarm.addListener(handleAlarmFired)` at module top level
    - Register `chrome.notifications.onClicked.addListener` to clear notification on click
    - These must be at the top level (outside functions) to survive service worker restarts
    - _Requirements: 5.3, 5.4, 6.6_

  - [x] 6.2 Add message handlers for action tracking and tab opening
    - Import `saveActionRecord`, `getActionRecords`, `clearActionRecords` from `./action_tracker.js`
    - Handle `OPEN_TAB` — call `chrome.tabs.create({ url })`, respond with `{ success: true }`
    - Handle `SAVE_ACTION` — call `saveActionRecord(payload)`, respond with `{ success: true, record }`
    - Handle `GET_ACTIONS` — call `getActionRecords(payload.domain)`, respond with `{ success: true, records }`
    - Handle `CLEAR_ACTIONS` — call `clearActionRecords(payload.domain)`, respond with `{ success: true }`
    - _Requirements: 1.2, 6.2_

  - [x] 6.3 Add message handlers for reminder operations
    - Import `scheduleReminder`, `cancelReminder`, `getReminders` from `./reminder_scheduler.js`
    - Handle `SCHEDULE_REMINDER` — call `scheduleReminder(payload)`, respond with `{ success: true, metadata }`
    - Handle `CANCEL_REMINDER` — call `cancelReminder(payload.alarmName)`, respond with `{ success: true }`
    - Handle `GET_REMINDERS` — call `getReminders(payload.domain)`, respond with `{ success: true, reminders }`
    - _Requirements: 6.3, 6.4, 6.5_

  - [ ]* 6.4 Write unit tests for background message routing
    - Test `OPEN_TAB` handler calls `chrome.tabs.create`
    - Test `SAVE_ACTION` handler calls `saveActionRecord`
    - Test `GET_ACTIONS` handler calls `getActionRecords`
    - Test `CLEAR_ACTIONS` handler calls `clearActionRecords`
    - Test `SCHEDULE_REMINDER` handler calls `scheduleReminder`
    - Test `CANCEL_REMINDER` handler calls `cancelReminder`
    - Test `GET_REMINDERS` handler calls `getReminders`
    - Test `chrome.alarms.onAlarm` listener is registered at top level
    - Test `chrome.notifications.onClicked` listener is registered at top level
    - _Requirements: 1.2, 5.3, 5.4, 6.2, 6.3, 6.4, 6.5_

- [x] 7. Update manifest permissions
  - Add `"alarms"` and `"notifications"` to the `permissions` array in `manifest.json`
  - Resulting permissions: `["storage", "activeTab", "alarms", "notifications"]`
  - _Requirements: 5.1, 5.2_

- [ ] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Extend content script UI with action buttons and tracking
  - [x] 9.1 Add tracking state loading on panel open
    - In `showAnalysisResults`, send `GET_ACTIONS` and `GET_REMINDERS` messages to background on panel open
    - Store returned `ActionRecord[]` and `ReminderMetadata[]` in local variables for rendering
    - Render tracking state before user interacts with buttons
    - _Requirements: 4.2, 7.5_

  - [x] 9.2 Render action buttons per mechanism in DataType cards
    - For `settings_url` / `web_form` mechanisms with `status: 'available'`: render "Opt Out" button
    - For `email` mechanisms with `status: 'available'`: render "Send Opt-Out Email" button
    - For `postal_mail` mechanisms: render "Set Reminder" button
    - Do not render action buttons for mechanisms with `vague` or `unavailable` status
    - Position buttons below existing opt-out mechanism display within each DataType card
    - _Requirements: 1.1, 2.1, 3.1, 7.1, 7.3_

  - [x] 9.3 Implement action button click handlers
    - "Opt Out" click: validate URL with `isValidOptOutUrl`, send `OPEN_TAB` message, then send `SAVE_ACTION` with action `opened_url`; show inline error for invalid URLs
    - "Send Opt-Out Email" click: call `buildMailtoLink`, open via `window.location.href = mailtoLink`, send `SAVE_ACTION` with action `composed_email`
    - "Set Reminder" click: send `SCHEDULE_REMINDER` with postal_mail type and 4320 min delay, send `SAVE_ACTION` with action `reminder_set`
    - Implement optimistic UI: button state changes to loading immediately on click, then to done/error on background response
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.4, 2.5, 2.6, 3.2, 3.6, 3.7, 7.6_

  - [x] 9.4 Render tracking indicators and follow-up reminders
    - For each mechanism with a corresponding `ActionRecord`: render checkmark (✅) and timestamp
    - After any completed action (opened URL, composed email): render "Set Follow-Up Reminder" button (14-day follow_up reminder)
    - Handle duplicate reminder detection: if reminder already exists, show scheduled date with cancel/reschedule option
    - _Requirements: 3.3, 3.4, 3.9, 4.3, 7.2_

  - [x] 9.5 Render progress summary and clear history
    - Render progress summary at top of opt-out section: "X/Y opt-out actions completed"
    - Compute completed count from `ActionRecord` matches against available mechanisms
    - Compute total count from all available opt-out mechanisms across data types
    - Add "Clear History" button that sends `CLEAR_ACTIONS` and resets UI
    - _Requirements: 4.4, 4.5_

  - [ ]* 9.6 Write unit tests for content script UI extensions
    - Test "Opt Out" button renders for settings_url with available status
    - Test "Send Opt-Out Email" button renders for email with available status
    - Test "Set Reminder" button renders for postal_mail
    - Test no action buttons for vague/unavailable status
    - Test "Set Follow-Up Reminder" button renders after completed action
    - Test checkmark and timestamp render for completed actions
    - Test progress summary shows correct counts
    - Test error message for invalid URL
    - Test button "Done" state after URL opened and email composed
    - Test "Reminder Set" state with date after scheduling
    - Test duplicate reminder shows existing date
    - Test tracking state loads on panel open
    - Test optimistic button state change on click
    - _Requirements: 1.1, 1.4, 1.5, 2.1, 2.6, 3.1, 3.3, 3.7, 3.9, 4.3, 4.4, 7.2, 7.5, 7.6_

  - [ ]* 9.7 Write property tests for UI rendering
    - **Property 1: Action Button Rendering by Mechanism Type**
    - **Property 8: Tracking Indicator Rendering**
    - **Property 9: Progress Summary Counts**
    - **Validates: Requirements 1.1, 2.1, 3.1, 4.3, 4.4, 7.1, 7.2, 7.3**

- [ ] 10. Final build verification and wiring
  - [ ] 10.1 Verify Vite build succeeds with new modules
    - Run `npm run build` and confirm `dist/background.js` and `dist/content_script.js` include the new modules
    - Confirm no new dependencies were added (bundle stays lean)
    - Confirm `action_tracker.ts` and `reminder_scheduler.ts` are bundled into `background.js`
    - Confirm `buildMailtoLink` is bundled into `content_script.js`
    - _Requirements: 6.1_

  - [ ] 10.2 Verify manifest permissions are correct
    - Confirm `manifest.json` has `["storage", "activeTab", "alarms", "notifications"]`
    - _Requirements: 5.1, 5.2_

- [x] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- No new npm dependencies — only Chrome platform APIs (`chrome.alarms`, `chrome.notifications`, `chrome.tabs`)
- Two new source files: `src/action_tracker.ts` and `src/reminder_scheduler.ts`
- Email template builder (`buildMailtoLink`) lives in `content_script.ts` since it's a pure function with no Chrome API dependency
