# DataGuard — Technical Documentation

> A comprehensive guide to the DataGuard browser extension: architecture, build process, challenges, and how we used Kiro to build it.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [How We Built It — The Journey](#2-how-we-built-it--the-journey)
3. [Problems We Solved](#3-problems-we-solved)
4. [How We Used Kiro — Full Platform Utilization](#4-how-we-used-kiro--full-platform-utilization)
5. [Architecture Reference](#5-architecture-reference)
6. [Setup Guide](#6-setup-guide)
7. [Future Improvements](#7-future-improvements)

---

## 1. Project Overview

### What DataGuard Is

DataGuard is a Chrome browser extension that helps users understand what personal data websites collect, how it's used, and what they can do about it. Instead of reading thousands of words of legal text, users get a plain-language breakdown powered by AI — plus breach history, real-time field scanning, and automated opt-out tools.

### The Problem It Solves

Privacy policies are long, dense, and written in legal language. Most people click "Accept" without reading them. DataGuard changes that by:

1. **Automatically detecting** privacy policies on any website
2. **Analyzing the full policy text** with a legal-aware AI model
3. **Presenting a visual risk breakdown** — what data is collected, why, and who it's shared with
4. **Checking breach history** — has this site leaked data before?
5. **Automating opt-outs** — one-click actions to exercise your privacy rights

### Architecture Overview

DataGuard follows a message-driven pipeline architecture built on Chrome's Manifest V3 extension model:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser Tab                                                        │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Content Script (content.js)                                  │  │
│  │  • Scans DOM for data input fields                            │  │
│  │  • Classifies field sensitivity                               │  │
│  │  • Detects privacy policy links                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                    │ chrome.runtime.sendMessage
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Background Service Worker (background.js)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐    │
│  │  Fetcher      │  │  Parser      │  │  AI Engine Client      │    │
│  │  HTTP fetch   │  │  HTML/PDF/   │  │  Prompt construction   │    │
│  │  Redirects    │  │  Text parse  │  │  LLM API calls         │    │
│  └──────────────┘  └──────────────┘  │  Response validation    │    │
│  ┌──────────────┐  ┌──────────────┐  └────────────────────────┘    │
│  │  Action       │  │  Reminder    │                                │
│  │  Tracker      │  │  Scheduler   │  HIBP breach data caching     │
│  └──────────────┘  └──────────────┘                                │
└─────────────────────────────────────────────────────────────────────┘
                    │ chrome.runtime.sendMessage
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Popup UI (popup.html + popup.js + popup.css)                       │
│  • Site info header with risk badge                                 │
│  • Data collection field display                                    │
│  • AI policy analysis section                                       │
│  • Breach history with domain/category tabs                         │
│  • Opt-out guidance with action buttons                             │
│  • Settings and bookmarking                                         │
└─────────────────────────────────────────────────────────────────────┘
```

The key insight: **all risk data comes from the actual privacy policy text**, not from page metadata or heuristics. The AI reads the full legal document and extracts structured information.

---

## 2. How We Built It — The Journey

### Phase 1: Foundation — Privacy Policy Detection & AI Analysis

We started with Michael's requirements document as the single source of truth. It defined the full vision: a privacy guardian that detects policies, analyzes them with AI, extracts opt-outs, checks breach history, and automates privacy actions.

Using Kiro's spec-driven development workflow, we created our first formal spec: `policy-detection-risk-identification`. This followed the Requirements → Design → Tasks pipeline:

- **Requirements**: 6 formal requirements with 40+ acceptance criteria covering detection, fetching, parsing, AI analysis, API key configuration, and risk display
- **Design**: Full architecture document with component diagrams, data models, AI prompt design, sequence flows, and 10 correctness properties
- **Tasks**: 11 implementation tasks broken into subtasks, each traced back to specific requirements

The core pipeline we built:

```
Detect policy links → Fetch HTML → Parse text → Send to AI → Display results
```

**AI Model Choice**: We used Llama 3.1 8B Instruct via HuggingFace's Inference Providers API. Legal-specialized models understand terms like "legitimate interest", "data controller", and "onward transfer" without hallucinating. The model receives a structured system prompt with risk level rules, ambiguity detection rules, and deviation flagging rules, then returns a JSON object with data types, risk levels, purposes, and warnings.

**Key technical decisions in Phase 1:**
- TypeScript with strict mode for type safety across the message-passing boundary
- Vite for multi-entry extension builds (background, content script, popup)
- Manual JSON validation instead of Ajv (MV3 CSP blocks `eval()`)
- Regex-based HTML parser instead of DOMParser (service workers have no DOM)

### Phase 2: Opt-Out Guidance

With the core analysis pipeline working, we extended it to extract opt-out mechanisms from privacy policies. This was our second Kiro spec: `opt-out-guidance`.

The design decision was to keep it as a single AI call — the system prompt was extended to also extract opt-out information for each data type, rather than making a separate API call. This kept latency and cost unchanged.

We added three opt-out status classifications:
- **Available**: The policy describes a concrete mechanism (URL, email, web form, account settings, postal mail)
- **Vague**: The policy mentions opting out but doesn't describe how ("you may opt out" with no link)
- **Unavailable**: No opt-out information exists for that data type

The content script UI was extended to show opt-out status per data type with visual indicators (green for available, orange for vague, gray for unavailable) and a summary section showing counts.

### Phase 3: Opt-Out Automation

The third spec, `opt-out-automation`, added action buttons on top of the guidance:

- **"Opt Out" button** for settings URLs and web forms → opens in a new tab via `chrome.tabs.create`
- **"Send Opt-Out Email" button** → constructs a `mailto:` link with a pre-filled subject and body referencing GDPR/CCPA
- **"Add to Calendar" button** for postal mail → generates a downloadable `.ics` file with a 3-day reminder
- **Action tracking** → persists which actions the user has taken per domain in `chrome.storage.local`
- **Reminder scheduling** → uses `chrome.alarms` and `chrome.notifications` for follow-up reminders

Two new modules were introduced: `action_tracker.ts` for persisting action records and `reminder_scheduler.ts` for alarm management. Both are pure-logic modules with no DOM dependencies, testable in isolation.

### Phase 4: UI Integration with DataGuard Frontend

The frontend team built the DataGuard popup UI independently — a polished Chrome extension popup with field scanning, breach history from HIBP, and an opt-out database. The integration was a three-stage process:

**Stage 1: Manifest Merging**
The two halves of the project had separate `manifest.json` files. We merged them into a single root manifest that:
- Points the service worker to `dist/background.js` (the Vite-built TypeScript bundle)
- Points the content script to `DataGuard/content.js` (the frontend's field scanner)
- Points the popup to `DataGuard/popup.html` (the frontend's UI)

**Stage 2: AI Analysis Section**
We added an "AI Policy Analysis" section to the DataGuard popup UI. When the user clicks "Analyze Privacy Policy", the popup sends an `INITIATE_ANALYSIS` message to the background worker, which runs the full pipeline and returns structured results. The popup renders the analysis inline with the existing breach and field scanning data.

**Stage 3: Wiring Opt-Out Actions**
The opt-out action buttons, email templates, and calendar downloads were wired into the popup's opt-out section, replacing the static opt-out database with live AI-extracted guidance.

**Color Psychology**: The UI uses a trust-blue color scheme based on privacy color psychology research. Blue conveys trust and security. Risk levels use a traffic-light system: green (low), amber (medium), red (high). The overall design follows Apple's privacy label pattern — a visual grid showing 14 data categories at a glance.

### Phase 5: Polish

The final phase focused on visual refinement:
- Replaced emoji indicators with professional SVG icons throughout the popup
- Added micro-interactions: staggered fade-in animations for data cards, hover effects on buttons, smooth collapsible sections
- Applied consistent spacing, typography, and border-radius values
- Added a loading spinner during page scanning and AI analysis
- Implemented error states with helpful messages (can't scan chrome:// pages, network errors, etc.)

---

## 3. Problems We Solved

### MV3 Service Worker Crash

**Problem**: Three dependencies crashed the Manifest V3 service worker on load:
- `jsdom` — uses Node.js APIs (`fs`, `path`, `child_process`) not available in service workers
- `pdfjs-dist` — attempts to access `document` and `window` globals
- `ajv` — uses `eval()` and `new Function()` for schema compilation, which MV3's Content Security Policy blocks

**Solution**: We replaced all three:
- **jsdom** → Regex-based HTML parser that extracts text and headings without a DOM
- **pdfjs-dist** → Removed PDF parsing from the service worker (future: Chrome offscreen documents)
- **ajv** → Hand-written `validateRiskAnalysis()` function that checks every field manually

The manual validator is ~80 lines of TypeScript but is CSP-safe, has zero dependencies, and is fully testable.

### HuggingFace API Changes

**Problem**: The original HuggingFace Inference API endpoint (`api-inference.huggingface.co`) was deprecated. Requests returned 404 or unexpected response formats.

**Solution**: Migrated to the new [Inference Providers API](https://huggingface.co/docs/inference-providers) at `router.huggingface.co`. The new API uses a different URL structure and authentication flow but supports the same models. We updated the `SaulLMAdapter` to use the new endpoint format.

### Context Length Limits

**Problem**: Llama 3.1 8B has an 8,192 token context window. Many privacy policies exceed this when combined with the system prompt (~800 tokens) and response budget.

**Solution**: Implemented a token budget manager:
1. Estimate token count at 4 characters per token
2. Reserve 800 tokens for the system prompt and 1,200 for the response
3. Cap policy text at ~4,000 tokens (~16,000 characters)
4. If truncated, append `[TRUNCATED]` and add a warning to `analysisWarnings`

For the OpenAI GPT-4o fallback, the budget is much larger (128K context), so truncation rarely applies.

### Content Script Conflicts

**Problem**: Two content scripts were registered in the manifest — the AI pipeline's `content_script.ts` (compiled to `dist/content_script.js`) and the DataGuard frontend's `DataGuard/content.js`. Both listened for `chrome.runtime.onMessage`, causing message routing conflicts where responses were swallowed or duplicated.

**Solution**: Removed the AI pipeline's content script from the manifest. The DataGuard frontend's content script handles all page-side logic (field scanning, DOM interaction). The AI analysis pipeline runs entirely in the background worker and communicates results to the popup, not the content script.

### CSP Violations

**Problem**: Ajv's schema compilation uses `eval()` and `new Function()`, both of which are blocked by Manifest V3's Content Security Policy. The service worker crashed immediately on import.

**Solution**: Built a manual JSON validator (`validateRiskAnalysis` in `ai_engine_client.ts`) that checks every field with explicit type guards:

```typescript
if (typeof e.riskLevel !== 'string' || !VALID_RISK_LEVELS.includes(e.riskLevel)) {
  errors.push(`dataTypes[${i}].riskLevel must be 'low', 'medium', or 'high'`);
}
```

This pattern was extended for opt-out guidance validation, action record validation, and reminder metadata validation — all without `eval()`.

---

## 4. How We Used Kiro — Full Platform Utilization

### Spec-Driven Development (Kiro Specs)

We created **4 formal specs** using Kiro's spec workflow, each following the Requirements → Design → Tasks pipeline:

#### Spec 1: `policy-detection-risk-identification`
The foundational pipeline spec. Covers the entire detect → fetch → parse → analyze → display flow.
- **Requirements**: 6 requirements, 40+ acceptance criteria
- **Design**: Component architecture, data models (PolicyLink, Page_Metadata, RawDocument, Parsed_Policy, Risk_Analysis), AI prompt design with risk/ambiguity/deviation rules, 4 sequence flow diagrams, 10 correctness properties
- **Tasks**: 11 top-level tasks with subtasks, 3 checkpoints, property-based tests for link detection, redirect resolution, parsing round-trip, and Risk_Analysis invariants

#### Spec 2: `opt-out-guidance`
Extended the AI analysis to extract opt-out mechanisms from policy text.
- **Requirements**: 6 requirements covering extraction, schema, prompt extension, display, vague language flagging, and backward compatibility
- **Design**: Type extensions (OptOutGuidance, OptOutMechanism), prompt additions, validation rules, UI rendering specs, 7 correctness properties
- **Tasks**: 7 top-level tasks, property tests for structural invariants, status-mechanisms consistency, round-trip serialization, and backward compatibility normalization

#### Spec 3: `opt-out-automation`
Added action buttons, email templates, reminders, and tracking on top of guidance.
- **Requirements**: 8 requirements covering URL opening, email pre-filling, reminder scheduling, action tracking, manifest permissions, background integration, UI extension, and storage schema
- **Design**: Two new modules (action_tracker, reminder_scheduler), email template builder, alarm name encoding scheme, storage key namespacing, 13+ correctness properties
- **Tasks**: 11 top-level tasks with subtasks for each module, message handler wiring, and UI integration

#### Spec 4: `privacy-tool`
The original high-level spec from Michael's requirements document, covering the full product vision including features beyond the hackathon scope (jurisdiction detection, automated rights actions, policy change alerts).

Each spec's requirements used formal acceptance criteria with the pattern:
```
WHEN [condition], THE [system] SHALL [behavior]
IF [condition], THEN THE [system] SHALL [behavior]
FOR ALL [inputs], [property] SHALL hold
```

The design documents included formal correctness properties that mapped directly to property-based tests using fast-check.

### Steering Files

We created three workspace-level steering files in `.kiro/steering/` that guided Kiro's code generation:

#### `tech.md` — Technology Stack
Documented the exact versions of every dependency (Vite 5.3.4, TypeScript 5.5.3, Vitest 2.0.4, fast-check 3.21.0), build commands, output directory structure, and path aliases. This ensured Kiro never introduced incompatible dependencies or used wrong build commands.

#### `structure.md` — Project Structure & Architecture
Defined the directory layout, architecture pattern (message-driven pipeline), component responsibilities, data flow, file naming conventions (snake_case for source, PascalCase for types, camelCase for functions), code organization patterns (ASCII art section separators, custom AnalysisError class), and testing structure. This kept all generated code consistent with the existing codebase.

#### `product.md` — Product Overview
Described what the Privacy Tool is, its core capabilities, target users, AI model choices, and current limitations. This gave Kiro product context so it could make informed decisions about feature scope and user-facing text.

### Hooks

We used Kiro hooks for automated workflows:

- **`generate-technical-report`** — A user-triggered hook that generates a comprehensive technical report documenting the entire repository. It instructs Kiro to review all source files, test files, spec files, and configuration files, then produce a narrative report covering architecture, implementation approach, workflow steps, integration patterns, and current state.

### AI-Powered Development

Kiro was used throughout the development process for:

- **Iterative debugging**: When the service worker crashed on load (jsdom, pdfjs, Ajv), Kiro diagnosed the root cause (MV3 CSP restrictions, missing DOM APIs) and implemented replacements (regex parser, manual validator)
- **API migration**: When HuggingFace deprecated the old inference endpoint, Kiro updated the adapter to use the new Inference Providers API
- **Complex multi-file refactoring**: Merging two separate manifest.json files, integrating background scripts, and wiring message handlers across content script, background worker, and popup
- **Real-time pair programming**: One team member tested the extension in Chrome while Kiro fixed issues in real-time — a tight feedback loop of "it crashed" → Kiro reads the error → Kiro fixes the code → rebuild → test again

### Frontend Team (DataGuard UI)

The frontend team used Kiro independently to build the DataGuard popup UI:

- **`DataGuard/popup.html`** — The main extension popup with sections for field scanning, breach history, AI analysis, and opt-out guidance
- **`DataGuard/popup.css`** — Professional styling with trust-blue color scheme, risk badges, staggered animations, and responsive layout
- **`DataGuard/popup.js`** — Field classification, HIBP breach queries, opt-out database lookups, and UI state management
- **`DataGuard/content.js`** — Content script for real-time page scanning and field detection
- **`DataGuard/background.js`** — Background logic for breach data caching and bookmark notifications

Kiro's steering files ensured both teams maintained consistent code style and conventions despite working independently.

### Integration

Kiro managed the three-stage integration of the backend AI pipeline with the frontend DataGuard UI:

**Stage 1: Merged manifests and background scripts**
- Combined two `manifest.json` files into one root manifest
- Pointed the service worker to the Vite-built `dist/background.js`
- Resolved permission conflicts (both needed `storage`, `activeTab`; backend added `alarms`, `notifications`)

**Stage 2: Added AI analysis section to DataGuard popup**
- Inserted an "AI Policy Analysis" section into `popup.html`
- Wired the "Analyze Privacy Policy" button to send `INITIATE_ANALYSIS` messages
- Rendered AI results (risk levels, data types, warnings) inline in the popup

**Stage 3: Wired opt-out actions and polished UI**
- Connected opt-out action buttons to the background worker's message handlers
- Integrated email template generation and calendar file downloads
- Applied consistent styling across AI-generated and static content

---

## 5. Architecture Reference

### Source Files

```
src/
├── types.ts                 # All TypeScript interfaces and type definitions
│                            # PolicyLink, Page_Metadata, RawDocument, Section,
│                            # Parsed_Policy, Risk_Analysis, DataTypeEntry,
│                            # OptOutGuidance, OptOutMechanism, ActionRecord,
│                            # ReminderMetadata, AnalysisError, LLMAdapter,
│                            # and all ExtensionMessage types
│
├── content_script.ts        # DOM scanning and policy detection
│                            # scanDomForPolicyLinks() — regex matching on <a> elements
│                            # detectConsentDialog() — cookie banner detection
│                            # extractPageMetadata() — builds Page_Metadata
│                            # buildMailtoLink() — pre-filled opt-out email construction
│                            # buildIcsFile() — .ics calendar file generation
│                            # normalizeOptOutGuidance() — backward compat for cached data
│                            # showAnalysisResults() — renders AI analysis in overlay
│                            # Action button click handlers for opt-out automation
│
├── background.ts            # Pipeline orchestration and message routing
│                            # runAnalysisPipeline() — fetch → parse → analyze → cache
│                            # Message handlers: POLICY_DETECTED, INITIATE_ANALYSIS,
│                            #   VALIDATE_API_KEY, OPEN_TAB, SAVE_ACTION, GET_ACTIONS,
│                            #   CLEAR_ACTIONS, SCHEDULE_REMINDER, CANCEL_REMINDER,
│                            #   GET_REMINDERS
│                            # HIBP breach data fetching and caching
│                            # Bookmark and notification management
│                            # Top-level alarm and notification listeners
│
├── fetcher.ts               # Document retrieval with redirect resolution
│                            # fetchDocument() — HTTP fetch with MIME type detection
│                            # wrapManualText() — wraps pasted text as RawDocument
│
├── ai_engine_client.ts      # AI analysis and response validation
│                            # SaulLMAdapter — HuggingFace Inference Providers API
│                            # OpenAIAdapter — OpenAI chat completions API
│                            # buildSystemPrompt() — risk + opt-out extraction rules
│                            # buildUserMessage() — policy text with domain context
│                            # validateRiskAnalysis() — manual CSP-safe JSON validation
│                            # analyzePolicy() — public entry point
│                            # testApiKey() — lightweight validation request
│
├── action_tracker.ts        # Opt-out action persistence
│                            # saveActionRecord() — stores in chrome.storage.local
│                            # getActionRecords() — retrieves by domain
│                            # clearActionRecords() — removes by domain
│                            # validateActionRecord() — field validation
│
├── reminder_scheduler.ts    # Chrome alarm management
│                            # scheduleReminder() — creates chrome.alarm + stores metadata
│                            # cancelReminder() — clears alarm + removes metadata
│                            # getReminders() — retrieves by domain
│                            # handleAlarmFired() — creates chrome.notification
│                            # buildAlarmName() / parseAlarmName() — deterministic encoding
│
├── popup.ts                 # Settings UI logic
│                            # API key input, provider selection, validation
│
└── parser/
    ├── index.ts             # Parser dispatcher — routes by RawDocument.format
    │                        # serializeParsedPolicy() / deserializeParsedPolicy()
    ├── html_parser.ts       # HTML extraction using Readability
    ├── pdf_parser.ts        # PDF extraction using pdf.js
    └── text_parser.ts       # Plain text extraction with heading heuristics
```

```
DataGuard/
├── manifest.json            # Original frontend manifest (merged into root)
├── popup.html               # Main extension popup UI
├── popup.css                # Popup styling (trust-blue theme, animations)
├── popup.js                 # Popup logic (field display, breaches, AI wiring)
├── content.js               # Content script (field scanning, classification)
├── background.js            # Frontend background (breach caching, bookmarks)
├── options.html             # Extension options page
├── options.js               # Options logic
├── data/
│   ├── opt_out_database.json    # Static opt-out instructions by domain
│   └── tracker_domains.json     # Known tracker domain list
├── utils/
│   ├── field_classifier.js      # Input field sensitivity classification
│   └── risk_scorer.js           # Risk score computation
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Message Flow

All communication between extension components uses `chrome.runtime.sendMessage` with typed message objects:

```
Content Script                    Background Worker                 Popup UI
     │                                  │                              │
     │── POLICY_DETECTED ──────────────▶│                              │
     │◀── SHOW_ALERT_POPUP ────────────│                              │
     │                                  │                              │
     │                                  │◀── INITIATE_ANALYSIS ───────│
     │                                  │   (fetch → parse → analyze)  │
     │                                  │── ANALYSIS_COMPLETE ────────▶│
     │                                  │   or ANALYSIS_ERROR          │
     │                                  │                              │
     │                                  │◀── VALIDATE_API_KEY ────────│
     │                                  │── API_KEY_VALIDATION_RESULT ▶│
     │                                  │                              │
     │                                  │◀── OPEN_TAB ────────────────│
     │                                  │◀── SAVE_ACTION ─────────────│
     │                                  │◀── GET_ACTIONS ─────────────│
     │                                  │◀── CLEAR_ACTIONS ───────────│
     │                                  │◀── SCHEDULE_REMINDER ───────│
     │                                  │◀── CANCEL_REMINDER ─────────│
     │                                  │◀── GET_REMINDERS ───────────│
```

### Storage Keys

| Key | Type | Description |
|---|---|---|
| `apiKey` | `string` | HuggingFace or OpenAI API key |
| `adapterType` | `'saulm' \| 'openai'` | Selected AI provider |
| `hibp_breaches_cache` | `object` | Cached HIBP breach data with TTL |
| `dg_bookmarked_sites` | `string[]` | User's bookmarked domains |
| `dg_notified_breaches` | `string[]` | Breach IDs already notified |
| `optOutActions_{domain}` | `ActionRecord[]` | Opt-out actions taken per domain |
| `optOutReminders_{domain}` | `ReminderMetadata[]` | Active reminders per domain |
| `{policyUrl}` | `Risk_Analysis` | Cached AI analysis results |

### API Endpoints

| API | Endpoint | Purpose |
|---|---|---|
| HuggingFace Inference | `https://router.huggingface.co/...` | Llama 3.1 8B Instruct for policy analysis |
| OpenAI (fallback) | `https://api.openai.com/v1/chat/completions` | GPT-4o for policy analysis |
| Have I Been Pwned | `https://haveibeenpwned.com/api/v3/breaches` | Breach history data |

---

## 6. Setup Guide

### Prerequisites

- **Node.js** 18+ and **npm** 9+
- **Google Chrome** (or Chromium-based browser)
- **HuggingFace account** with an API token ([create one here](https://huggingface.co/settings/tokens))

### Installation

1. **Clone the repository**

```bash
git clone <repo-url>
cd dataguard
```

2. **Install dependencies**

```bash
npm install
```

3. **Build the extension**

```bash
npm run build
```

This compiles TypeScript and bundles the source files into `dist/`:
- `dist/background.js` — Service worker
- `dist/content_script.js` — Content script (policy detection)
- `dist/popup.js` — Settings UI

4. **Load in Chrome**

- Open `chrome://extensions/`
- Enable **Developer mode** (toggle in the top right)
- Click **Load unpacked**
- Select the **root project folder** (the directory containing the root `manifest.json`)

5. **Configure your API key**

- Click the DataGuard icon in the Chrome toolbar
- Navigate to **Settings** (gear icon in the footer)
- Select your AI provider (HuggingFace recommended)
- Paste your API key
- Click **Save & Validate**

The extension validates the key by sending a lightweight test request. If validation succeeds, the key is saved to `chrome.storage.local`.

### Getting a HuggingFace API Key

1. Go to [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
2. Click **New token**
3. Give it a name (e.g., "DataGuard")
4. Select **Read** access (Inference permissions)
5. Click **Generate**
6. Copy the token and paste it into DataGuard's settings

### Running Tests

```bash
# Run all unit tests
npm test

# Run tests in watch mode during development
npm run dev    # (builds in watch mode)

# Run smoke tests (requires API key)
PRIVACY_TOOL_API_KEY=your_key npm run smoke
```

### Development Workflow

```bash
# Start Vite in watch mode — rebuilds on file changes
npm run dev

# In Chrome, go to chrome://extensions/ and click the refresh icon
# on the DataGuard extension after each rebuild
```

---

## 7. Future Improvements

### PDF Policy Support
Currently, PDF privacy policies are not fully supported in the service worker due to `pdfjs-dist` requiring DOM APIs. The solution is Chrome's [Offscreen Documents API](https://developer.chrome.com/docs/extensions/reference/api/offscreen), which allows creating a hidden document with DOM access for PDF parsing.

### Automated Form Submission
The current opt-out automation opens URLs and pre-fills emails, but doesn't submit forms automatically. A future version could use Chrome's scripting API to auto-fill and submit opt-out web forms with user confirmation.

### Multi-Language Policy Analysis
The AI prompt currently assumes English-language policies. Adding language detection and multilingual prompt templates would extend coverage to non-English websites.

### Browser Sync for Settings
Settings and action history are stored in `chrome.storage.local`, which doesn't sync across devices. Migrating to `chrome.storage.sync` would let users access their opt-out history and bookmarks on any device.

### Firefox and Safari Ports
The extension uses Chrome Manifest V3 APIs. Firefox supports MV3 with minor differences (background scripts vs. service workers). Safari supports MV3 via Xcode's Web Extension converter. Both ports are feasible with an adapter layer for browser-specific APIs.

### Policy Change Detection
The original requirements include revisit alerts — detecting when a previously analyzed policy has changed and notifying the user. This would involve storing a hash of the policy text and comparing on revisit.

### Jurisdiction-Based Legal Rights
Detecting the user's jurisdiction (GDPR, CCPA, VCDPA, etc.) and showing which specific legal rights they can exercise against each service. This was in the original requirements but scoped out for the hackathon.

---

*Built with [Kiro](https://kiro.dev) during a hackathon. MIT License.*
