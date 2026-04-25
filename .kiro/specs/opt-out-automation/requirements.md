# Requirements Document

## Introduction

This document covers the **Opt-Out Automation** feature for the Privacy Tool browser extension. The feature builds on the existing Opt-Out Guidance capability — which identifies opt-out mechanisms (settings URLs, emails, web forms, account steps, postal mail) per data type — and adds automation, pre-filling, reminders, and tracking on top of those identified mechanisms.

The scope includes four capabilities:

1. **Auto-open opt-out URLs** — One-click action to open settings URLs and web form URLs in a new browser tab
2. **Pre-filled opt-out emails** — Generate `mailto:` links with a subject line and body template requesting data opt-out or deletion, so the user only has to click send
3. **Reminders and notifications** — Schedule reminders for postal mail opt-outs, follow-up checks after a configurable number of days, and periodic renewal reminders using the `chrome.alarms` and `chrome.notifications` APIs
4. **Opt-out action tracking** — Persist which opt-out actions the user has taken (opened URL, composed email, set reminder) per data type per domain, so the user can see progress

**Technical constraints:**
- Manifest V3 Chrome extension with service worker (no DOM APIs in background)
- Background bundle is ~32KB — no new dependencies; use only Chrome platform APIs
- `chrome.storage.local` for persistence of tracking and reminder data
- `chrome.alarms` API for scheduling reminders (MV3-compatible, replaces `setTimeout`/`setInterval`)
- `chrome.notifications` API for showing reminder notifications
- Current permissions: `storage`, `activeTab`. This feature requires adding: `alarms`, `notifications`
- Content script handles all UI rendering; background handles alarm scheduling and notification dispatch

**Explicitly out of scope:** Automated form submission, automated email sending (the user must click send), scraping or interacting with third-party opt-out pages, and any server-side components.

## Glossary

- **Privacy_Tool**: The browser extension that detects privacy policies, analyzes them with AI, and displays risk, opt-out guidance, and opt-out automation controls to the User
- **User**: An individual who has installed the Privacy_Tool browser extension
- **Risk_Analysis**: The structured output produced by the AI engine from a parsed privacy policy, containing identified data types, risk levels, purposes, third-party sharing, and opt-out guidance
- **Data_Type**: A category of personal data identified in a privacy policy (e.g., location data, browsing history, email address)
- **Opt_Out_Guidance**: The structured description of how a User can opt out of a specific Data_Type's collection or sharing, extracted from the policy text by the AI engine — includes status, mechanisms, summary, and warning note
- **Opt_Out_Mechanism**: A specific actionable method described in a privacy policy for opting out — one of: settings_url, email, web_form, account_steps, postal_mail
- **Opt_Out_Action**: A user-initiated action taken through the Privacy_Tool to execute an Opt_Out_Mechanism — opening a URL, composing a pre-filled email, or acknowledging a postal mail reminder
- **Action_Record**: A persisted record of an Opt_Out_Action taken by the User, stored in chrome.storage.local, containing the domain, data type, mechanism type, action taken, and timestamp
- **Reminder**: A scheduled notification created via the chrome.alarms API that fires at a future time to prompt the User about a pending or follow-up opt-out action
- **Reminder_Type**: The category of a Reminder — one of: postal_mail (remind to send a letter), follow_up (check if opt-out was processed), renewal (periodic re-opt-out)
- **Risk_Breakdown**: The UI panel displayed by the content script overlay showing the Risk_Analysis results, including data types, risk levels, opt-out guidance, and opt-out action buttons
- **Action_Tracker**: The module responsible for persisting and retrieving Action_Records in chrome.storage.local
- **Reminder_Scheduler**: The module in the background service worker responsible for creating, listing, and clearing chrome.alarms and dispatching chrome.notifications when alarms fire
- **Opt_Out_Email_Template**: A pre-filled email body and subject line generated from the domain name, data type, and mechanism details, used to construct a mailto link

## Requirements

### Requirement 1: Auto-Open Opt-Out URLs

**User Story:** As a User, I want to click an action button next to a data type with a settings URL or web form opt-out mechanism and have that URL open in a new browser tab, so that I can quickly navigate to the opt-out page without copying and pasting.

#### Acceptance Criteria

1. WHEN a Data_Type in the Risk_Breakdown has an Opt_Out_Mechanism of type settings_url or web_form with status available, THE Privacy_Tool SHALL display an "Opt Out" action button next to that mechanism
2. WHEN the User clicks the "Opt Out" action button for a settings_url or web_form mechanism, THE Privacy_Tool SHALL open the mechanism URL in a new browser tab using the chrome.tabs API
3. WHEN the User clicks the "Opt Out" action button for a settings_url or web_form mechanism, THE Privacy_Tool SHALL record an Action_Record with the domain, data type, mechanism type, action "opened_url", and current timestamp
4. WHEN the mechanism URL is opened in a new tab, THE Privacy_Tool SHALL update the action button to show a "Done" state indicating the URL has been opened
5. IF the mechanism URL is empty or malformed, THEN THE Privacy_Tool SHALL display an inline error message stating "This opt-out link appears to be invalid" and SHALL NOT attempt to open a new tab

### Requirement 2: Pre-Filled Opt-Out Emails

**User Story:** As a User, I want to click an action button next to a data type with an email opt-out mechanism and have a pre-filled email compose window open, so that I can send an opt-out request without writing the email from scratch.

#### Acceptance Criteria

1. WHEN a Data_Type in the Risk_Breakdown has an Opt_Out_Mechanism of type email with status available, THE Privacy_Tool SHALL display a "Send Opt-Out Email" action button next to that mechanism
2. WHEN the User clicks the "Send Opt-Out Email" action button, THE Privacy_Tool SHALL construct a mailto link containing: the mechanism email address as the recipient, a subject line in the format "Data Opt-Out Request — [domain]", and a body template requesting opt-out or deletion of the specific Data_Type
3. THE Opt_Out_Email_Template body SHALL include: a greeting, a statement identifying the User as a user of the domain, a request to opt out of or delete the specific Data_Type, a reference to applicable privacy regulations, and a closing requesting confirmation
4. WHEN the User clicks the "Send Opt-Out Email" action button, THE Privacy_Tool SHALL open the constructed mailto link, triggering the default email client
5. WHEN the mailto link is opened, THE Privacy_Tool SHALL record an Action_Record with the domain, data type, mechanism type email, action "composed_email", and current timestamp
6. WHEN the mailto link is opened, THE Privacy_Tool SHALL update the action button to show a "Done" state indicating the email was composed
7. THE Opt_Out_Email_Template SHALL encode the subject and body using encodeURIComponent to handle special characters in the domain name, data type, or template text

### Requirement 3: Reminder Scheduling

**User Story:** As a User, I want to set reminders for opt-out actions that require follow-up — postal mail, processing verification, and periodic renewal — so that I do not forget to complete or verify my opt-out requests.

#### Acceptance Criteria

1. WHEN a Data_Type has an Opt_Out_Mechanism of type postal_mail, THE Risk_Breakdown SHALL display a "Set Reminder" button that schedules a Reminder of type postal_mail with a default delay of 3 days
2. WHEN the User clicks a "Set Reminder" button for a postal_mail mechanism, THE Reminder_Scheduler SHALL create a chrome.alarm with a name encoding the domain, data type, and Reminder_Type, and a delay of 3 days (4320 minutes)
3. WHEN the User completes any Opt_Out_Action (opened URL, composed email), THE Risk_Breakdown SHALL display a "Set Follow-Up Reminder" button that schedules a Reminder of type follow_up with a default delay of 14 days
4. WHEN the User clicks a "Set Follow-Up Reminder" button, THE Reminder_Scheduler SHALL create a chrome.alarm with a delay of 14 days (20160 minutes)
5. WHEN a chrome.alarm fires, THE Reminder_Scheduler SHALL create a chrome.notification with a title identifying the domain and data type, and a body describing the reminder action (send letter, check processing status, or renew opt-out)
6. WHEN the User clicks a "Set Reminder" or "Set Follow-Up Reminder" button, THE Privacy_Tool SHALL record an Action_Record with the domain, data type, Reminder_Type, action "reminder_set", and current timestamp
7. WHEN a Reminder is successfully scheduled, THE Privacy_Tool SHALL update the reminder button to show a "Reminder Set" state with the scheduled date
8. THE Reminder_Scheduler SHALL store Reminder metadata (domain, data type, Reminder_Type, scheduled time, alarm name) in chrome.storage.local so that reminders persist across service worker restarts
9. IF the User clicks a reminder button for a domain and data type that already has an active Reminder of the same Reminder_Type, THEN THE Privacy_Tool SHALL display the existing reminder date and offer to cancel or reschedule the reminder instead of creating a duplicate

### Requirement 4: Opt-Out Action Tracking

**User Story:** As a User, I want to see which opt-out actions I have already taken for each data type on each domain, so that I can track my progress and know what remains.

#### Acceptance Criteria

1. THE Action_Tracker SHALL persist all Action_Records in chrome.storage.local under a key namespaced by domain
2. WHEN the Risk_Breakdown is displayed for a domain, THE Privacy_Tool SHALL load all Action_Records for that domain and display the completion status for each Data_Type's opt-out mechanisms
3. WHEN an Action_Record exists for a Data_Type and mechanism, THE Risk_Breakdown SHALL display a visual indicator (checkmark and timestamp) showing that the action was taken and when
4. THE Risk_Breakdown SHALL display a progress summary at the top of the opt-out section showing the count of completed opt-out actions versus total available opt-out mechanisms for the current domain
5. WHEN the User clicks a "Clear History" button for a domain, THE Action_Tracker SHALL remove all Action_Records for that domain from chrome.storage.local and reset the UI to show no completed actions
6. FOR ALL Action_Records, serializing to JSON via JSON.stringify and deserializing via JSON.parse SHALL produce an equivalent set of Action_Records (round-trip property)

### Requirement 5: Manifest Permission Updates

**User Story:** As a developer, I want the extension manifest to declare the alarms and notifications permissions, so that the reminder and notification APIs are available at runtime.

#### Acceptance Criteria

1. THE manifest.json permissions array SHALL include "alarms" in addition to the existing "storage" and "activeTab" permissions
2. THE manifest.json permissions array SHALL include "notifications" in addition to the existing permissions
3. WHEN the Privacy_Tool service worker starts, THE Reminder_Scheduler SHALL register a listener for the chrome.alarms.onAlarm event to handle fired alarms
4. WHEN the Privacy_Tool service worker starts, THE Reminder_Scheduler SHALL register a listener for the chrome.notifications.onClicked event to handle notification clicks

### Requirement 6: Background Service Worker Integration

**User Story:** As a developer, I want the background service worker to handle reminder scheduling and notification dispatch without introducing new dependencies, so that the background bundle stays lean.

#### Acceptance Criteria

1. THE Reminder_Scheduler SHALL be implemented as functions within the background service worker module without importing external libraries
2. THE background service worker SHALL handle new message types for reminder operations: SCHEDULE_REMINDER, CANCEL_REMINDER, and GET_REMINDERS
3. WHEN the content script sends a SCHEDULE_REMINDER message, THE background service worker SHALL create the corresponding chrome.alarm and store the Reminder metadata in chrome.storage.local
4. WHEN the content script sends a CANCEL_REMINDER message, THE background service worker SHALL clear the corresponding chrome.alarm and remove the Reminder metadata from chrome.storage.local
5. WHEN the content script sends a GET_REMINDERS message with a domain, THE background service worker SHALL return all active Reminder metadata for that domain from chrome.storage.local
6. THE background service worker SHALL NOT use DOM APIs, setTimeout for long delays, or setInterval for reminder scheduling — only chrome.alarms

### Requirement 7: Content Script UI Extension

**User Story:** As a User, I want the opt-out action buttons, tracking indicators, and reminder controls to appear inline within the existing Risk_Breakdown panel, so that I can take action without navigating away from the results.

#### Acceptance Criteria

1. THE content script SHALL render "Opt Out" action buttons inline within each Data_Type card in the Risk_Breakdown, positioned below the existing opt-out mechanism display
2. THE content script SHALL render action tracking indicators (checkmark and timestamp) inline next to each mechanism that has a corresponding Action_Record
3. THE content script SHALL render reminder buttons ("Set Reminder", "Set Follow-Up Reminder") inline below the action buttons for applicable mechanisms
4. THE content script SHALL communicate with the background service worker via chrome.runtime.sendMessage for all operations that require chrome.tabs, chrome.alarms, or chrome.notifications APIs
5. WHEN the Risk_Breakdown panel is opened for a domain that has existing Action_Records, THE content script SHALL load and display the tracking state before the User interacts with any buttons
6. THE content script SHALL update button states (loading, done, error) synchronously in the UI when the User clicks an action button, without waiting for the background response to render the initial state change

### Requirement 8: Data Storage Schema

**User Story:** As a developer, I want a well-defined storage schema for action records and reminder metadata, so that data is consistently structured and retrievable.

#### Acceptance Criteria

1. THE Action_Record SHALL contain the following fields: id (unique string), domain (string), dataType (string), mechanismType (Opt_Out_Mechanism type), action (one of: opened_url, composed_email, reminder_set), timestamp (ISO 8601 string)
2. THE Reminder metadata SHALL contain the following fields: alarmName (string), domain (string), dataType (string), reminderType (Reminder_Type), scheduledTime (ISO 8601 string), delayMinutes (number)
3. THE Action_Tracker SHALL store Action_Records under the chrome.storage.local key "optOutActions_{domain}" as a JSON array
4. THE Reminder_Scheduler SHALL store Reminder metadata under the chrome.storage.local key "optOutReminders_{domain}" as a JSON array
5. THE storage schema SHALL validate that Action_Record ids are unique within a domain's action list
6. FOR ALL Reminder metadata objects, the alarmName field SHALL encode the domain, dataType, and reminderType in a deterministic format so that duplicate detection and cancellation can use the alarm name as a lookup key
