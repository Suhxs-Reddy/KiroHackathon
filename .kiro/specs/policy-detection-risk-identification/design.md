# Design Document: Privacy Policy Detection and Data Risk Identification

## Overview

This document describes the technical design for **Step 1** of the Privacy Customization Tool: the backend pipeline that detects privacy policy links on a web page, fetches and parses the policy document, sends the parsed content to an AI engine for structured risk extraction, and produces a `Risk_Analysis` JSON object that the frontend can consume.

The pipeline is implemented as a browser extension targeting Chrome, Edge, and Safari (Manifest V3). The core flow is:

```
Target_Page DOM
    │
    ▼
[Content Script] ── detects Policy_Links ──► Page_Metadata
    │
    ▼ (user initiates analysis)
[Background Service Worker]
    │
    ├─► fetch Policy_Document (HTML / PDF / plain text)
    │
    ├─► [Parser Module] ──► Parsed_Policy
    │
    ├─► [AI Engine Client] ──► Risk_Analysis JSON
    │
    └─► Risk_Analysis stored in extension local storage
              │
              ▼
        [Frontend UI] consumes Risk_Analysis (out of scope for Step 1)
```

All data risk information — data types collected, stated purposes, third-party sharing, risk levels — is derived **exclusively** from the full text of the `Policy_Document`. Page metadata is used only to locate the `Policy_Link`; it is never a source of risk data.

---

## Architecture

### Extension Components

The extension is structured around the Manifest V3 model with three distinct execution contexts:

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser Tab (Content Script context)                           │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  content_script.ts                                       │   │
│  │  • Scans DOM for Policy_Links on page load               │   │
│  │  • Detects consent dialogs / cookie banners              │   │
│  │  • Builds Page_Metadata                                  │   │
│  │  • Sends POLICY_DETECTED message to background           │   │
│  │  • Injects Alert_Popup overlay into page                 │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                          │  chrome.runtime.sendMessage
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Background Service Worker (persistent context)                 │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  background.ts                                           │   │
│  │  • Receives messages from content script                 │   │
│  │  • Orchestrates the detect → fetch → parse → analyze     │   │
│  │    pipeline                                              │   │
│  │  • Manages extension local storage (API key, cache)      │   │
│  │  • Sends analysis results back to content script / popup │   │
│  └──────────────────────────────────────────────────────────┘   │
│           │                    │                                 │
│           ▼                    ▼                                 │
│  ┌─────────────────┐  ┌─────────────────────────────────────┐   │
│  │  fetcher.ts     │  │  ai_engine_client.ts                │   │
│  │  • HTTP fetch   │  │  • Builds structured prompt         │   │
│  │  • PDF detect   │  │  • Calls cloud LLM API              │   │
│  │  • Redirect     │  │  • Parses JSON response             │   │
│  │    resolution   │  │  • Validates Risk_Analysis schema   │   │
│  └────────┬────────┘  └─────────────────────────────────────┘   │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  parser/                                                │    │
│  │  ├── html_parser.ts   (Readability + DOM traversal)     │    │
│  │  ├── pdf_parser.ts    (pdf.js text extraction)          │    │
│  │  ├── text_parser.ts   (heading heuristics)              │    │
│  │  └── index.ts         (format dispatch + serialization) │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                          │  chrome.runtime.sendMessage
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Extension Popup (popup.html / popup.ts)                        │
│  • Settings UI (API key entry, validation)                      │
│  • Displays Risk_Breakdown from Risk_Analysis JSON              │
│  • (Risk_Breakdown display is out of scope for Step 1)          │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Choices

| Concern | Choice | Rationale |
|---|---|---|
| Extension manifest | Manifest V3 | Required for Chrome/Edge; Safari supports MV3 via Xcode wrapper |
| Content script language | TypeScript | Type safety for data models; compiles to plain JS |
| HTML parsing | Mozilla Readability + DOMParser | Battle-tested article extraction; strips nav/footer noise |
| PDF parsing | pdf.js (Mozilla) | Runs in browser context; no native binary dependency |
| AI API | **Mistral Legal / `legal-bert` family via OpenAI-compatible REST** | Legal-domain fine-tuned models (e.g. Mistral-7B-Legal, LegalBERT, or SaulLM-7B) are significantly more accurate on ToS/privacy policy language than general-purpose LLMs — they understand terms like "legitimate interest", "data controller", "aggregate data", and "service providers" without hallucinating. User supplies API key; adapter pattern supports swapping models. |
| Local storage | `chrome.storage.local` (encrypted key slot) | MV3-compatible; survives service worker restarts |
| Serialization | JSON (native) | Universal; round-trip property testable |
| Test framework | Vitest + fast-check | Vitest for unit/integration; fast-check for property-based tests |

---

## Components and Interfaces

### 1. Content Script (`content_script.ts`)

**Responsibilities:**
- Run on `document_idle` for every page load
- Scan the DOM for `<a>` elements whose `innerText` or `href` matches privacy/ToS patterns
- Detect consent dialogs (elements matching common cookie-banner selectors)
- Construct a `Page_Metadata` object
- Send a `POLICY_DETECTED` message to the background service worker
- Receive `SHOW_ALERT_POPUP` message and inject the overlay

**Policy_Link detection heuristics:**
```
Link text patterns (case-insensitive):
  /privacy\s*(policy)?/
  /terms\s*(of\s*(service|use))?/
  /data\s*(protection|processing)/
  /cookie\s*(policy|notice)/

Href patterns:
  /privacy/
  /terms/
  /legal/
  /tos/
  /gdpr/
```

**Message interface:**
```typescript
// content → background
interface PolicyDetectedMessage {
  type: 'POLICY_DETECTED';
  payload: Page_Metadata;
}

// background → content
interface ShowAlertPopupMessage {
  type: 'SHOW_ALERT_POPUP';
  payload: { policyLinks: PolicyLink[]; hasConsentDialog: boolean };
}

// content → background (user clicks "Analyze")
interface InitiateAnalysisMessage {
  type: 'INITIATE_ANALYSIS';
  payload: { policyUrl: string } | { manualText: string };
}
```

### 2. Background Service Worker (`background.ts`)

**Responsibilities:**
- Receive `POLICY_DETECTED` and `INITIATE_ANALYSIS` messages
- Orchestrate the pipeline: fetch → parse → AI analyze
- Store `Risk_Analysis` results in `chrome.storage.local`
- Forward results to the popup/content script

**Pipeline orchestration (pseudocode):**
```
async function runAnalysisPipeline(input: AnalysisInput): Promise<Risk_Analysis> {
  const rawDoc = await fetcher.fetch(input)          // Step 1: fetch
  const parsed  = await parser.parse(rawDoc)          // Step 2: parse
  const analysis = await aiClient.analyze(parsed)     // Step 3: AI analyze
  await storage.set(input.url, analysis)              // Step 4: cache
  return analysis
}
```

### 3. Fetcher (`fetcher.ts`)

**Responsibilities:**
- Perform `fetch()` with redirect following
- Detect response MIME type (`text/html`, `application/pdf`, `text/plain`)
- Return `RawDocument` with content and detected format
- Handle network errors, CORS restrictions, and non-200 responses

**Interface:**
```typescript
interface RawDocument {
  content: string | ArrayBuffer;  // string for HTML/text, ArrayBuffer for PDF
  format: 'html' | 'pdf' | 'text';
  finalUrl: string;               // URL after redirect resolution
  fetchedAt: string;              // ISO 8601 timestamp
}

async function fetchDocument(url: string): Promise<RawDocument>
```

### 4. Parser Module (`parser/`)

**Responsibilities:**
- Dispatch to the correct sub-parser based on `RawDocument.format`
- Produce a `Parsed_Policy` from any supported format
- Serialize/deserialize `Parsed_Policy` to/from JSON

**Sub-parsers:**

| Sub-parser | Input | Strategy |
|---|---|---|
| `html_parser.ts` | HTML string | Run Readability to extract article body; walk DOM to collect headings (`h1`–`h6`) and their associated text blocks |
| `pdf_parser.ts` | ArrayBuffer | Use pdf.js `getTextContent()` per page; reconstruct reading order; detect headings by font-size heuristic |
| `text_parser.ts` | Plain text string | Split on blank lines; classify heading lines by: ALL_CAPS, ends with `:`, or preceded by blank line + short length |

**Interface:**
```typescript
async function parseDocument(raw: RawDocument): Promise<Parsed_Policy>
function serializeParsedPolicy(p: Parsed_Policy): string   // → JSON string
function deserializeParsedPolicy(json: string): Parsed_Policy
```

### 5. AI Engine Client (`ai_engine_client.ts`)

**Responsibilities:**
- Load the API key from encrypted storage
- Build a structured prompt from the `Parsed_Policy` full text
- Call the configured LLM endpoint (OpenAI-compatible chat completions API)
- Request JSON-mode output
- Validate the response against the `Risk_Analysis` JSON schema
- Return a typed `Risk_Analysis` object

**Interface:**
```typescript
async function analyzePolicy(parsed: Parsed_Policy): Promise<Risk_Analysis>
```

---

## Data Models

### `PolicyLink`

```typescript
interface PolicyLink {
  url: string;           // Absolute URL of the policy document
  linkText: string;      // Visible anchor text
  linkType: 'privacy_policy' | 'terms_of_service' | 'cookie_policy' | 'data_processing' | 'unknown';
}
```

### `Page_Metadata`

Used **only** to locate `Policy_Links` on the page. Never used as a source of risk data.

```typescript
interface Page_Metadata {
  domain: string;              // e.g. "example.com"
  pageTitle: string;           // document.title
  pageUrl: string;             // window.location.href
  detectedPolicyLinks: PolicyLink[];
  hasConsentDialog: boolean;   // true if a cookie banner was detected
  detectionTimestamp: string;  // ISO 8601
}
```

### `RawDocument`

```typescript
interface RawDocument {
  content: string | ArrayBuffer;
  format: 'html' | 'pdf' | 'text';
  finalUrl: string;
  fetchedAt: string;  // ISO 8601
}
```

### `Section`

```typescript
interface Section {
  heading: string;   // Section heading text (empty string if no heading)
  text: string;      // Full text content of the section
  level: number;     // Heading depth: 0 = document root, 1 = h1/top-level, etc.
}
```

### `Parsed_Policy`

```typescript
interface Parsed_Policy {
  sourceUrl: string;           // Final URL after redirect resolution
  format: 'html' | 'pdf' | 'text' | 'manual';
  fullText: string;            // Complete extracted text (all sections concatenated)
  sections: Section[];         // Ordered list of sections with headings
  parsedAt: string;            // ISO 8601 timestamp
}
```

**Serialization contract:** `Parsed_Policy` serializes to JSON and deserializes back to an equivalent object (round-trip property — see Requirement 3.7).

### `DataTypeEntry`

```typescript
type RiskLevel = 'low' | 'medium' | 'high';

interface DataTypeEntry {
  dataType: string;              // e.g. "location data", "browsing history"
  riskLevel: RiskLevel;
  purposes: string[];            // Stated purposes from policy text
  sharedWithThirdParties: boolean;
  thirdPartyCategories: string[]; // e.g. ["advertising networks", "analytics providers"]
  warningNote: string | null;    // Non-null when AI flagged ambiguous/broad language
  deviationNote: string | null;  // Non-null when AI flagged unusual data access
}
```

### `Risk_Analysis`

This is the **primary output contract** that the frontend will consume. It is produced by the AI Engine and stored in extension local storage as JSON.

```typescript
interface Risk_Analysis {
  schemaVersion: string;         // e.g. "1.0" — for forward compatibility
  policyUrl: string;             // URL of the analyzed Policy_Document
  targetDomain: string;          // e.g. "example.com"
  analyzedAt: string;            // ISO 8601 timestamp
  overallRiskLevel: RiskLevel;   // Highest risk level among all DataTypeEntries
  dataTypes: DataTypeEntry[];    // One entry per identified Data_Type; empty array if none found
  analysisWarnings: string[];    // Top-level warnings (e.g. "Policy text was truncated")
  modelUsed: string;             // e.g. "gpt-4o" — for auditability
}
```

**JSON Schema (for validation):**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Risk_Analysis",
  "type": "object",
  "required": ["schemaVersion", "policyUrl", "targetDomain", "analyzedAt",
               "overallRiskLevel", "dataTypes", "analysisWarnings", "modelUsed"],
  "properties": {
    "schemaVersion": { "type": "string" },
    "policyUrl":     { "type": "string", "format": "uri" },
    "targetDomain":  { "type": "string" },
    "analyzedAt":    { "type": "string", "format": "date-time" },
    "overallRiskLevel": { "type": "string", "enum": ["low", "medium", "high"] },
    "dataTypes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["dataType", "riskLevel", "purposes",
                     "sharedWithThirdParties", "thirdPartyCategories",
                     "warningNote", "deviationNote"],
        "properties": {
          "dataType":               { "type": "string", "minLength": 1 },
          "riskLevel":              { "type": "string", "enum": ["low", "medium", "high"] },
          "purposes":               { "type": "array", "items": { "type": "string" } },
          "sharedWithThirdParties": { "type": "boolean" },
          "thirdPartyCategories":   { "type": "array", "items": { "type": "string" } },
          "warningNote":            { "type": ["string", "null"] },
          "deviationNote":          { "type": ["string", "null"] }
        }
      }
    },
    "analysisWarnings": { "type": "array", "items": { "type": "string" } },
    "modelUsed":        { "type": "string" }
  }
}
```

**`overallRiskLevel` derivation rule:** `overallRiskLevel` is always the maximum `riskLevel` across all `dataTypes` entries. If `dataTypes` is empty, `overallRiskLevel` is `"low"`.

---

## AI Prompt Design

### AI Model Selection

The AI Engine uses a **legal-domain fine-tuned model** as the primary analysis engine. General-purpose LLMs are imprecise on legal privacy language — they misclassify "legitimate interest" as low-risk, treat "service providers" as benign, and miss nuanced data-sharing clauses. A legal-specialized model handles this correctly out of the box.

**Primary model: SaulLM-7B-Instruct** (or Mistral-7B-Legal as fallback)
- Fine-tuned on legal corpora including privacy policies, ToS agreements, GDPR/CCPA regulatory text, and court documents
- Available via Hugging Face Inference API (`https://api-inference.huggingface.co/models/Equall/Saul-Instruct-v1`) with a user-provided HF API token
- Supports instruction-following and JSON-mode output
- Context window: 32k tokens — sufficient for most privacy policies without truncation
- Understands legal terms of art: "legitimate interest", "data controller", "processor", "aggregate", "pseudonymous", "onward transfer"

**Fallback model: OpenAI GPT-4o** (if user prefers or HF is unavailable)
- Configured via standard OpenAI API key
- Used with the same prompt; slightly less precise on legal language but widely accessible

**Model adapter pattern:** The `ai_engine_client.ts` uses an `LLMAdapter` interface so the underlying model can be swapped without changing the pipeline:

```typescript
interface LLMAdapter {
  complete(systemPrompt: string, userMessage: string): Promise<string>;
  modelId: string;
}

class SaulLMAdapter implements LLMAdapter { ... }   // HuggingFace Inference API
class OpenAIAdapter implements LLMAdapter { ... }   // OpenAI chat completions
```

The user configures which adapter to use in extension settings, along with their API key for the chosen provider.

### Prompt Architecture

The AI Engine uses a two-message prompt (system + user) with JSON mode enabled. The system prompt establishes the role and output contract; the user message supplies the policy text.

### System Prompt

```
You are a privacy policy analyst. Your job is to read the full text of a privacy policy
or Terms of Service document and extract structured information about personal data
collection and risk.

You MUST respond with a single valid JSON object that conforms exactly to this schema:

{
  "dataTypes": [
    {
      "dataType": "<string: category of personal data, e.g. 'location data'>",
      "riskLevel": "<'low' | 'medium' | 'high'>",
      "purposes": ["<string: stated purpose from policy text>"],
      "sharedWithThirdParties": <boolean>,
      "thirdPartyCategories": ["<string: category of third party, e.g. 'advertising networks'>"],
      "warningNote": "<string or null: flag if language is ambiguous or vague>",
      "deviationNote": "<string or null: flag if data access is unusually broad>"
    }
  ],
  "analysisWarnings": ["<string: top-level issues, e.g. policy text was truncated>"]
}

Risk level assignment rules:
- HIGH: biometric data, precise location, health/medical data, financial account data,
        government ID numbers, data sold to third parties, data used for profiling
- MEDIUM: browsing history, device identifiers, IP address, email address,
          inferred interests, data shared with advertising partners
- LOW: anonymized/aggregated data, technical logs not linked to identity,
       data used solely for service operation with no third-party sharing

Ambiguity rules (set warningNote):
- Set warningNote when the policy uses vague phrases like "may share", "partners",
  "affiliates", "service providers" without specifying who or for what purpose
- Set warningNote when opt-out language is present but the mechanism is not described

Deviation rules (set deviationNote):
- Set deviationNote when the policy claims rights to sell, license, or transfer data
  beyond what is needed to operate the service
- Set deviationNote when data retention is indefinite or unusually long (> 5 years)
- Set deviationNote when the policy grants rights to combine data across unrelated services

Extract ALL distinct data types mentioned. Do not summarize multiple data types into one
unless they are genuinely the same category. If no personal data collection is mentioned,
return an empty dataTypes array.

All text in your response MUST be in plain language at or below an 8th-grade reading level.
Do not use legal jargon in purposes, warningNote, or deviationNote fields.
```

### User Message Template

```
Analyze the following privacy policy text and extract structured risk information.
The policy is from: {{targetDomain}}
Policy URL: {{policyUrl}}

--- POLICY TEXT START ---
{{fullPolicyText}}
--- POLICY TEXT END ---
```

### Token Budget and Truncation

Privacy policies can be long but SaulLM-7B has a 32k token context window, which covers the vast majority of real-world privacy policies (average ~2,500 words ≈ ~3,300 tokens). The AI Engine applies the following strategy:

1. Measure `fullText` token count (estimated at 4 chars/token)
2. If estimated tokens > 28,000 (context limit minus prompt overhead), truncate `fullText` to the first 28,000 tokens and append `"\n[TRUNCATED — policy text exceeded context limit]"`
3. Add `"Policy text was truncated due to length"` to `analysisWarnings` in the output

For the OpenAI GPT-4o fallback, the same truncation applies at 100,000 tokens.

### Response Validation

After receiving the LLM response, the AI Engine Client:
1. Parses the JSON string
2. Validates against the `Risk_Analysis` JSON schema (using `ajv`)
3. Derives `overallRiskLevel` from the maximum `riskLevel` in `dataTypes`
4. Adds `schemaVersion`, `policyUrl`, `targetDomain`, `analyzedAt`, `modelUsed` fields
5. Returns the complete `Risk_Analysis` object

If JSON parsing or schema validation fails, the client retries once with an explicit correction prompt, then surfaces an error to the user.

---

## Sequence Flows

### Flow 1: Automatic Detection

```
User navigates to page
        │
        ▼
content_script.ts (document_idle)
  ├── scanDomForPolicyLinks() → PolicyLink[]
  ├── detectConsentDialog() → boolean
  ├── build Page_Metadata
  └── sendMessage(POLICY_DETECTED, Page_Metadata)
        │
        ▼
background.ts
  ├── store Page_Metadata
  └── sendMessage(SHOW_ALERT_POPUP, { policyLinks, hasConsentDialog })
        │
        ▼
content_script.ts
  └── injectAlertPopup(policyLinks, hasConsentDialog)
```

### Flow 2: User Initiates Analysis

```
User clicks "Analyze" in Alert_Popup
        │
        ▼
content_script.ts
  └── sendMessage(INITIATE_ANALYSIS, { policyUrl })
        │
        ▼
background.ts: runAnalysisPipeline(policyUrl)
  │
  ├── fetcher.fetchDocument(policyUrl)
  │     ├── fetch() with redirect following
  │     ├── detect MIME type
  │     └── return RawDocument
  │
  ├── parser.parseDocument(RawDocument)
  │     ├── dispatch to html_parser / pdf_parser / text_parser
  │     └── return Parsed_Policy
  │
  ├── aiClient.analyzePolicy(Parsed_Policy)
  │     ├── load API key from storage
  │     ├── build system + user prompt
  │     ├── POST to LLM endpoint (JSON mode)
  │     ├── validate response schema
  │     └── return Risk_Analysis
  │
  ├── chrome.storage.local.set({ [policyUrl]: Risk_Analysis })
  │
  └── sendMessage(ANALYSIS_COMPLETE, Risk_Analysis)
        │
        ▼
content_script.ts / popup.ts
  └── display Risk_Breakdown (out of scope for Step 1)
```

### Flow 3: Manual Text Input

```
User pastes policy text into manual input field
        │
        ▼
content_script.ts
  └── sendMessage(INITIATE_ANALYSIS, { manualText })
        │
        ▼
background.ts
  ├── wrap manualText as RawDocument { format: 'text', content: manualText, ... }
  └── continue with parser → AI analyze → store → respond (same as Flow 2)
```

### Flow 4: API Key Configuration

```
User opens extension popup → Settings tab
        │
        ▼
popup.ts
  └── sendMessage(VALIDATE_API_KEY, { apiKey, endpoint })
        │
        ▼
background.ts
  ├── aiClient.testApiKey(apiKey, endpoint)
  │     └── POST lightweight test prompt to LLM endpoint
  ├── if success: chrome.storage.local.set({ apiKey: encrypt(apiKey) })
  └── sendMessage(API_KEY_VALIDATION_RESULT, { success, error? })
        │
        ▼
popup.ts
  └── display success or error message
```

---

## Correctness Properties


*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Policy_Link Detection Completeness and Precision

*For any* collection of anchor elements on a page, the DOM scanner SHALL return exactly those elements whose link text or href matches the privacy/ToS detection patterns — no false positives (non-policy links included) and no false negatives (policy links missed).

**Validates: Requirements 1.1**

### Property 2: Page_Metadata Structural Completeness

*For any* Target_Page, the extracted `Page_Metadata` SHALL always contain a non-empty `domain`, a `pageTitle`, a `pageUrl`, a `detectedPolicyLinks` array (possibly empty), a `hasConsentDialog` boolean, and a `detectionTimestamp` in ISO 8601 format.

**Validates: Requirements 1.7**

### Property 3: Redirect Resolution Correctness

*For any* HTTP redirect chain of any length, the fetcher SHALL resolve to the final URL in the chain and set `RawDocument.finalUrl` to that URL — regardless of how many intermediate redirects occur.

**Validates: Requirements 2.2**

### Property 4: Parsed_Policy Round-Trip

*For any* valid `Policy_Document` in any supported format (HTML, PDF, plain text), parsing the document into a `Parsed_Policy`, serializing to JSON, and deserializing from JSON SHALL produce a `Parsed_Policy` that is structurally and semantically equivalent to the original — all fields (`sourceUrl`, `format`, `fullText`, `sections`, `parsedAt`) are preserved without loss or mutation.

**Validates: Requirements 3.1, 3.5, 3.6, 3.7**

### Property 5: HTML Section Heading Hierarchy Preservation

*For any* HTML `Policy_Document` containing heading elements (`h1`–`h6`), the parsed `Parsed_Policy.sections` array SHALL contain entries for all headings in document order, with each section's `level` field correctly reflecting the heading depth (h1 → level 1, h2 → level 2, etc.).

**Validates: Requirements 3.2**

### Property 6: Plain Text Heading Detection

*For any* plain text `Policy_Document`, every line that matches at least one heading heuristic (ALL_CAPS, ends with `:`, or is a short line preceded by a blank line) SHALL appear as a `Section.heading` in the resulting `Parsed_Policy.sections` array.

**Validates: Requirements 3.4**

### Property 7: Risk_Analysis Structural Invariants

*For any* `Risk_Analysis` object produced by the AI Engine:
- Every `DataTypeEntry` in `dataTypes` SHALL have a `riskLevel` that is one of `"low"`, `"medium"`, or `"high"`
- Every `DataTypeEntry` SHALL have a boolean `sharedWithThirdParties` field
- `overallRiskLevel` SHALL equal the maximum `riskLevel` among all `DataTypeEntry` items (or `"low"` if `dataTypes` is empty)
- The object SHALL be losslessly serializable to JSON and deserializable back to an equivalent object

**Validates: Requirements 4.2, 4.5, 6.4, 6.6**

### Property 8: Risk Data Provenance

*For any* two `Parsed_Policy` objects with identical `fullText` but different metadata fields (`sourceUrl`, `parsedAt`), the AI Engine SHALL produce `Risk_Analysis` outputs with equivalent `dataTypes` arrays — confirming that risk data is derived exclusively from the policy text and not from metadata.

**Validates: Requirements 4.1**

### Property 9: Risk_Analysis Completeness

*For any* `Parsed_Policy` whose `fullText` contains at least one recognized personal data keyword (e.g., "location", "email address", "browsing history", "device identifier"), the AI Engine SHALL produce a `Risk_Analysis` with a non-empty `dataTypes` array.

**Validates: Requirements 4.6**

### Property 10: No Outbound Requests Without API Key

*For any* analysis attempt initiated when no valid API key is saved in extension storage, the AI Engine Client SHALL make zero outbound network requests to any external endpoint — the pipeline SHALL be blocked before any policy text leaves the browser.

**Validates: Requirements 5.6**

---

## Error Handling

### Error Categories and Responses

| Error | Detection Point | User-Facing Response | Recovery Path |
|---|---|---|---|
| No Policy_Link found | Content script | No automatic popup; toolbar icon still available | Manual trigger via toolbar |
| Fetch network error | Fetcher | "Could not retrieve the policy document. Check your connection." + manual input option | Retry or paste text |
| Fetch 4xx/5xx | Fetcher | "The policy page returned an error (HTTP {status})." + manual input option | Retry or paste text |
| Unsupported MIME type | Fetcher | "This policy format is not supported. You can paste the text manually." | Manual text input |
| Parse failure | Parser | "Could not parse the policy document." + manual input option | Manual text input |
| No API key configured | AI Engine Client | "Please configure your AI API key in Settings before running analysis." | Open settings |
| API key validation failure | AI Engine Client | "API key validation failed: {error detail}. The key was not saved." | Re-enter key |
| AI endpoint unavailable | AI Engine Client | "The AI service is unavailable. Check your API key and network, then retry." | Retry button |
| AI response invalid JSON | AI Engine Client | Retry once with correction prompt; if still invalid: "Analysis failed. Please retry." | Retry button |
| AI response schema invalid | AI Engine Client | Retry once; if still invalid: "Analysis returned unexpected data. Please retry." | Retry button |

### Error State Propagation

All errors are propagated as typed `AnalysisError` objects through the pipeline:

```typescript
interface AnalysisError {
  code: 'FETCH_ERROR' | 'PARSE_ERROR' | 'AI_UNAVAILABLE' | 'AI_INVALID_RESPONSE'
       | 'NO_API_KEY' | 'API_KEY_INVALID' | 'UNSUPPORTED_FORMAT';
  message: string;       // User-facing plain-language message
  detail?: string;       // Technical detail for logging (not shown to user)
  retryable: boolean;    // Whether a retry button should be shown
  manualInputFallback: boolean; // Whether manual text input should be offered
}
```

The background service worker catches all errors from the pipeline and sends an `ANALYSIS_ERROR` message to the content script/popup with the `AnalysisError` payload.

### Retry Logic

- **AI JSON parse failure**: Retry once automatically with an explicit correction prompt appended: `"Your previous response was not valid JSON. Respond with only a valid JSON object."`
- **AI endpoint 5xx**: Surface error immediately; provide a manual retry button (no automatic retry to avoid burning API quota)
- **Fetch network error**: Surface error immediately; provide a manual retry button

---

## Testing Strategy

### Overview

The testing strategy uses a dual approach:
- **Unit and integration tests** (Vitest): specific examples, edge cases, error conditions, and component wiring
- **Property-based tests** (Vitest + fast-check): universal properties across generated inputs

PBT is appropriate for this feature because the core pipeline components — the DOM scanner, the parser, the serializer, and the Risk_Analysis validator — are pure or near-pure functions with clear input/output behavior and large input spaces where edge cases matter.

### Test Framework Setup

```
vitest          — test runner (single-run mode: vitest --run)
fast-check      — property-based testing library
ajv             — JSON schema validation in tests
@mozilla/readability — HTML parser (mocked for unit tests)
pdfjs-dist      — PDF parser (mocked for unit tests)
```

### Property-Based Tests

Each property test runs a minimum of **100 iterations** via fast-check's `fc.assert(fc.property(...))`.

Each test is tagged with a comment referencing the design property:
```
// Feature: policy-detection-risk-identification, Property N: <property text>
```

#### Property 1: Policy_Link Detection Completeness and Precision
```typescript
// Feature: policy-detection-risk-identification, Property 1: Policy_Link Detection
fc.assert(fc.property(
  fc.array(anchorElementArbitrary()),  // random mix of policy and non-policy links
  (anchors) => {
    const result = scanDomForPolicyLinks(anchors);
    const expected = anchors.filter(matchesPolicyPattern);
    return deepEqual(result, expected);
  }
), { numRuns: 100 });
```

#### Property 2: Page_Metadata Structural Completeness
```typescript
// Feature: policy-detection-risk-identification, Property 2: Page_Metadata Structure
fc.assert(fc.property(
  pageArbitrary(),
  (page) => {
    const meta = extractPageMetadata(page);
    return (
      typeof meta.domain === 'string' && meta.domain.length > 0 &&
      typeof meta.pageTitle === 'string' &&
      typeof meta.pageUrl === 'string' &&
      Array.isArray(meta.detectedPolicyLinks) &&
      typeof meta.hasConsentDialog === 'boolean' &&
      isIso8601(meta.detectionTimestamp)
    );
  }
), { numRuns: 100 });
```

#### Property 3: Redirect Resolution Correctness
```typescript
// Feature: policy-detection-risk-identification, Property 3: Redirect Resolution
fc.assert(fc.property(
  fc.array(fc.webUrl(), { minLength: 1, maxLength: 10 }),  // redirect chain
  async (chain) => {
    const mockFetch = buildRedirectMock(chain);
    const result = await fetchDocument(chain[0], mockFetch);
    return result.finalUrl === chain[chain.length - 1];
  }
), { numRuns: 100 });
```

#### Property 4: Parsed_Policy Round-Trip
```typescript
// Feature: policy-detection-risk-identification, Property 4: Parsed_Policy Round-Trip
fc.assert(fc.property(
  parsedPolicyArbitrary(),
  (policy) => {
    const json = serializeParsedPolicy(policy);
    const restored = deserializeParsedPolicy(json);
    return deepEqual(policy, restored);
  }
), { numRuns: 100 });
```

#### Property 5: HTML Heading Hierarchy Preservation
```typescript
// Feature: policy-detection-risk-identification, Property 5: HTML Heading Hierarchy
fc.assert(fc.property(
  htmlDocumentWithHeadingsArbitrary(),
  (html) => {
    const parsed = parseHtml(html.content, html.url);
    const expectedHeadings = html.headings;  // known heading texts in order
    const actualHeadings = parsed.sections.map(s => s.heading).filter(Boolean);
    return arraysEqual(actualHeadings, expectedHeadings) &&
           headingLevelsCorrect(parsed.sections, html.headingLevels);
  }
), { numRuns: 100 });
```

#### Property 6: Plain Text Heading Detection
```typescript
// Feature: policy-detection-risk-identification, Property 6: Plain Text Heading Detection
fc.assert(fc.property(
  plainTextWithHeadingsArbitrary(),  // generates text with known heading lines
  (doc) => {
    const parsed = parsePlainText(doc.content, doc.url);
    const detectedHeadings = parsed.sections.map(s => s.heading).filter(Boolean);
    return doc.expectedHeadings.every(h => detectedHeadings.includes(h));
  }
), { numRuns: 100 });
```

#### Property 7: Risk_Analysis Structural Invariants
```typescript
// Feature: policy-detection-risk-identification, Property 7: Risk_Analysis Invariants
fc.assert(fc.property(
  riskAnalysisArbitrary(),
  (analysis) => {
    const validRiskLevels = new Set(['low', 'medium', 'high']);
    const allEntriesValid = analysis.dataTypes.every(
      dt => validRiskLevels.has(dt.riskLevel) && typeof dt.sharedWithThirdParties === 'boolean'
    );
    const maxLevel = computeMaxRiskLevel(analysis.dataTypes);
    const overallCorrect = analysis.overallRiskLevel === maxLevel;
    const jsonRoundTrip = deepEqual(analysis, JSON.parse(JSON.stringify(analysis)));
    return allEntriesValid && overallCorrect && jsonRoundTrip;
  }
), { numRuns: 100 });
```

#### Property 8: Risk Data Provenance
```typescript
// Feature: policy-detection-risk-identification, Property 8: Risk Data Provenance
fc.assert(fc.property(
  parsedPolicyArbitrary(),
  fc.string(),  // different sourceUrl
  async (policy, alternateUrl) => {
    const policy2 = { ...policy, sourceUrl: alternateUrl, parsedAt: new Date().toISOString() };
    const mockAi = deterministicMockAi();  // returns same output for same fullText
    const result1 = await mockAi.analyzePolicy(policy);
    const result2 = await mockAi.analyzePolicy(policy2);
    return deepEqual(result1.dataTypes, result2.dataTypes);
  }
), { numRuns: 100 });
```

#### Property 9: Risk_Analysis Completeness
```typescript
// Feature: policy-detection-risk-identification, Property 9: Risk_Analysis Completeness
fc.assert(fc.property(
  policyTextWithPersonalDataArbitrary(),  // always contains ≥1 personal data keyword
  async (policyText) => {
    const parsed = buildParsedPolicy(policyText);
    const mockAi = keywordAwareMockAi();  // returns non-empty dataTypes for known keywords
    const result = await mockAi.analyzePolicy(parsed);
    return result.dataTypes.length > 0;
  }
), { numRuns: 100 });
```

#### Property 10: No Outbound Requests Without API Key
```typescript
// Feature: policy-detection-risk-identification, Property 10: No Outbound Requests Without API Key
fc.assert(fc.property(
  parsedPolicyArbitrary(),
  async (policy) => {
    const mockStorage = emptyStorage();  // no API key configured
    const requestLog: string[] = [];
    const mockFetch = loggingFetch(requestLog);
    const client = new AiEngineClient(mockStorage, mockFetch);
    try { await client.analyzePolicy(policy); } catch (_) {}
    return requestLog.length === 0;
  }
), { numRuns: 100 });
```

### Unit and Integration Tests

**Content Script:**
- Detects policy links in a DOM with known anchor elements
- Does not send `SHOW_ALERT_POPUP` when no policy links are found (Req 1.6)
- Detects cookie banner elements by known selectors (Req 1.3)
- Sends `INITIATE_ANALYSIS` when "Analyze" button is clicked (Req 1.4)

**Fetcher:**
- Returns correct `format: 'html'` for `text/html` MIME type (Req 2.3)
- Returns correct `format: 'pdf'` for `application/pdf` MIME type (Req 2.3)
- Returns correct `format: 'text'` for `text/plain` MIME type (Req 2.3)
- Surfaces `FETCH_ERROR` with `manualInputFallback: true` on network failure (Req 2.5)
- Surfaces `FETCH_ERROR` on HTTP 403 response (Req 2.5)
- Wraps manual text input as `format: 'text'` RawDocument (Req 2.6)

**Parser:**
- Parses a fixture HTML policy and extracts known section headings (Req 3.2)
- Parses a fixture PDF policy and extracts known text content (Req 3.3)
- Handles empty document gracefully — returns Parsed_Policy with empty sections (Req 3.8)
- Returns `PARSE_ERROR` for binary content that is not a valid PDF (Req 3.8)

**AI Engine Client:**
- Blocks analysis and returns `NO_API_KEY` error when storage is empty (Req 5.1)
- Sends a test request during API key validation before saving (Req 5.3)
- Does not save API key when validation returns 401 (Req 5.5)
- Retries once with correction prompt on invalid JSON response (Req 4.7)
- Returns `AI_UNAVAILABLE` error on HTTP 503 from AI endpoint (Req 4.7)
- Produces `Risk_Analysis` with `warningNote` non-null for known vague language (Req 4.3)
- Produces `Risk_Analysis` with `deviationNote` non-null for known broad access language (Req 4.4)

**Background Service Worker (integration):**
- Full pipeline integration: mock fetch → real parser → mock AI → stored Risk_Analysis (Req 2.4)
- `ANALYSIS_ERROR` message sent to content script on fetch failure (Req 2.5)
- `ANALYSIS_COMPLETE` message sent with valid Risk_Analysis on success (Req 4.5)

**Risk_Analysis Data Contract:**
- `Risk_Analysis` with empty `dataTypes` is valid JSON and passes schema validation (Req 6.8)
- `Risk_Analysis` contains `policyUrl` and `targetDomain` fields (Req 6.7)
- Every `DataTypeEntry` has a non-empty `purposes` array (Req 6.3)

### Test File Structure

```
tests/
├── unit/
│   ├── content_script.test.ts
│   ├── fetcher.test.ts
│   ├── parser/
│   │   ├── html_parser.test.ts
│   │   ├── pdf_parser.test.ts
│   │   └── text_parser.test.ts
│   └── ai_engine_client.test.ts
├── integration/
│   └── pipeline.test.ts
└── property/
    ├── link_detection.property.test.ts    (Properties 1, 2)
    ├── fetcher.property.test.ts           (Property 3)
    ├── parser.property.test.ts            (Properties 4, 5, 6)
    ├── risk_analysis.property.test.ts     (Properties 7, 8, 9)
    └── security.property.test.ts         (Property 10)
```
