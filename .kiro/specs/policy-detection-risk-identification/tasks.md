# Implementation Plan: Privacy Policy Detection and Data Risk Identification

## Overview

Implement the Step 1 pipeline for the Privacy Customization Tool browser extension: detect privacy policy links on a page, fetch and parse the policy document (HTML, PDF, or plain text), send the parsed content to a legal-specialized AI engine, and produce a `Risk_Analysis` JSON object stored in extension local storage. The extension targets Chrome, Edge, and Safari using Manifest V3 and TypeScript.

The output contract for this step is the `Risk_Analysis` JSON object. Frontend Risk_Breakdown display is out of scope.

---

## Tasks

- [ ] 1. Scaffold the browser extension project
  - Create the directory structure: `src/`, `src/parser/`, `tests/unit/`, `tests/unit/parser/`, `tests/integration/`, `tests/property/`, `public/`
  - Write `manifest.json` (Manifest V3) declaring `background.service_worker`, `content_scripts` on `<all_urls>` at `document_idle`, `action` popup, and `storage` + `activeTab` permissions
  - Write `tsconfig.json` targeting ES2020 with `strict: true`, `moduleResolution: bundler`, and path aliases for `src/`
  - Write `vite.config.ts` (or `webpack.config.ts`) configured for multi-entry extension build: `background`, `content_script`, `popup`
  - Write `package.json` with dependencies: `@mozilla/readability`, `pdfjs-dist`, `ajv`; devDependencies: `vitest`, `fast-check`, `typescript`, `vite`, `@types/chrome`
  - Create stub entry files: `src/background.ts`, `src/content_script.ts`, `src/popup.ts`, `src/fetcher.ts`, `src/ai_engine_client.ts`, `src/parser/index.ts`, `src/parser/html_parser.ts`, `src/parser/pdf_parser.ts`, `src/parser/text_parser.ts`
  - Create `src/types.ts` with all shared TypeScript interfaces: `PolicyLink`, `Page_Metadata`, `RawDocument`, `Section`, `Parsed_Policy`, `DataTypeEntry`, `RiskLevel`, `Risk_Analysis`, `AnalysisError`, `LLMAdapter`, and all message types (`PolicyDetectedMessage`, `ShowAlertPopupMessage`, `InitiateAnalysisMessage`, `AnalysisCompleteMessage`, `AnalysisErrorMessage`, `ValidateApiKeyMessage`, `ApiKeyValidationResultMessage`)
  - Verify `npm run build` produces output bundles without TypeScript errors
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 3.1, 4.1, 5.1_

- [ ] 2. Implement the Content Script — DOM scanning and Page_Metadata
  - [ ] 2.1 Implement `scanDomForPolicyLinks(document: Document): PolicyLink[]` in `src/content_script.ts`
    - Match `<a>` elements whose `innerText` satisfies `/privacy\s*(policy)?/i`, `/terms\s*(of\s*(service|use))?/i`, `/data\s*(protection|processing)/i`, `/cookie\s*(policy|notice)/i`
    - Match `<a>` elements whose `href` satisfies `/privacy/i`, `/terms/i`, `/legal/i`, `/tos/i`, `/gdpr/i`
    - Resolve relative hrefs to absolute URLs using `window.location.origin`
    - Classify each link into `linkType`: `privacy_policy`, `terms_of_service`, `cookie_policy`, `data_processing`, or `unknown`
    - _Requirements: 1.1_

  - [ ]* 2.2 Write property test for Policy_Link detection completeness and precision
    - **Property 1: Policy_Link Detection Completeness and Precision**
    - **Validates: Requirements 1.1**
    - File: `tests/property/link_detection.property.test.ts`
    - Use `fc.array(anchorElementArbitrary())` to generate random mixes of policy and non-policy anchor elements
    - Assert `scanDomForPolicyLinks(anchors)` returns exactly the elements matching the detection patterns — no false positives, no false negatives

  - [ ] 2.3 Implement `detectConsentDialog(document: Document): boolean` and `extractPageMetadata(document: Document): Page_Metadata`
    - Detect consent dialogs by querying common cookie-banner selectors (e.g. `[id*="cookie"]`, `[class*="consent"]`, `[id*="gdpr"]`, `[aria-label*="cookie"]`)
    - Build `Page_Metadata` with `domain` (from `window.location.hostname`), `pageTitle`, `pageUrl`, `detectedPolicyLinks`, `hasConsentDialog`, and `detectionTimestamp` (ISO 8601 via `new Date().toISOString()`)
    - _Requirements: 1.3, 1.7_

  - [ ]* 2.4 Write property test for Page_Metadata structural completeness
    - **Property 2: Page_Metadata Structural Completeness**
    - **Validates: Requirements 1.7**
    - File: `tests/property/link_detection.property.test.ts`
    - Use `pageArbitrary()` to generate random page inputs
    - Assert every `Page_Metadata` output has non-empty `domain`, `pageTitle`, `pageUrl`, array `detectedPolicyLinks`, boolean `hasConsentDialog`, and ISO 8601 `detectionTimestamp`

  - [ ] 2.5 Implement content script message handling and Alert_Popup injection
    - On `document_idle`, call `extractPageMetadata` and send `POLICY_DETECTED` to background via `chrome.runtime.sendMessage`
    - Listen for `SHOW_ALERT_POPUP` message and inject an overlay `<div>` into the page DOM listing detected policy links and a consent dialog notice
    - Render an "Analyze" button in the overlay; on click, send `INITIATE_ANALYSIS` with `{ policyUrl }` to background
    - If no policy links were detected, do not inject the overlay automatically (Req 1.6)
    - _Requirements: 1.2, 1.3, 1.4, 1.6_

  - [ ]* 2.6 Write unit tests for content script
    - File: `tests/unit/content_script.test.ts`
    - Test: detects policy links in a DOM with known anchor elements (Req 1.1)
    - Test: does not send `SHOW_ALERT_POPUP` when no policy links are found (Req 1.6)
    - Test: detects cookie banner elements by known selectors (Req 1.3)
    - Test: sends `INITIATE_ANALYSIS` when "Analyze" button is clicked (Req 1.4)

- [ ] 3. Implement the Fetcher
  - [ ] 3.1 Implement `fetchDocument(url: string): Promise<RawDocument>` in `src/fetcher.ts`
    - Use `fetch(url, { redirect: 'follow' })` to follow HTTP redirects automatically
    - Capture `response.url` as `finalUrl` after redirect resolution
    - Detect format from `Content-Type` header: `text/html` → `'html'`, `application/pdf` → `'pdf'`, `text/plain` → `'text'`
    - For HTML and plain text, read body as `string` via `response.text()`; for PDF, read as `ArrayBuffer` via `response.arrayBuffer()`
    - Set `fetchedAt` to `new Date().toISOString()`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 3.2 Write property test for redirect resolution correctness
    - **Property 3: Redirect Resolution Correctness**
    - **Validates: Requirements 2.2**
    - File: `tests/property/fetcher.property.test.ts`
    - Use `fc.array(fc.webUrl(), { minLength: 1, maxLength: 10 })` to generate redirect chains
    - Build a mock `fetch` that simulates the chain; assert `result.finalUrl === chain[chain.length - 1]`

  - [ ] 3.3 Implement error handling in the fetcher
    - Throw `AnalysisError` with `code: 'FETCH_ERROR'`, `retryable: true`, `manualInputFallback: true` on network failure
    - Throw `AnalysisError` with `code: 'FETCH_ERROR'` on non-200 HTTP status, including the status code in `message`
    - Throw `AnalysisError` with `code: 'UNSUPPORTED_FORMAT'`, `manualInputFallback: true` when `Content-Type` is not HTML, PDF, or plain text
    - _Requirements: 2.5_

  - [ ] 3.4 Implement manual text input wrapping
    - Export `wrapManualText(text: string): RawDocument` that returns `{ content: text, format: 'text', finalUrl: 'manual', fetchedAt: new Date().toISOString() }`
    - _Requirements: 2.6_

  - [ ]* 3.5 Write unit tests for the fetcher
    - File: `tests/unit/fetcher.test.ts`
    - Test: returns `format: 'html'` for `text/html` MIME type (Req 2.3)
    - Test: returns `format: 'pdf'` for `application/pdf` MIME type (Req 2.3)
    - Test: returns `format: 'text'` for `text/plain` MIME type (Req 2.3)
    - Test: throws `FETCH_ERROR` with `manualInputFallback: true` on network failure (Req 2.5)
    - Test: throws `FETCH_ERROR` on HTTP 403 response (Req 2.5)
    - Test: `wrapManualText` returns `format: 'text'` RawDocument (Req 2.6)

- [ ] 4. Implement the Parser Module
  - [ ] 4.1 Implement `parseHtml(content: string, url: string): Parsed_Policy` in `src/parser/html_parser.ts`
    - Use `@mozilla/readability` with a `DOMParser`-created document to extract the article body
    - Walk the Readability output DOM to collect `h1`–`h6` elements and their associated text blocks, building a `Section[]` in document order with `level` set to the heading depth (h1 → 1, h2 → 2, etc.)
    - Set `fullText` to the concatenation of all section texts
    - Set `sourceUrl`, `format: 'html'`, `parsedAt`
    - _Requirements: 3.1, 3.2, 3.5_

  - [ ]* 4.2 Write property test for HTML heading hierarchy preservation
    - **Property 5: HTML Section Heading Hierarchy Preservation**
    - **Validates: Requirements 3.2**
    - File: `tests/property/parser.property.test.ts`
    - Use `htmlDocumentWithHeadingsArbitrary()` to generate HTML with known heading texts and levels
    - Assert `parseHtml` output sections contain all headings in document order with correct `level` values

  - [ ] 4.3 Implement `parsePdf(content: ArrayBuffer, url: string): Promise<Parsed_Policy>` in `src/parser/pdf_parser.ts`
    - Load the PDF using `pdfjs-dist` `getDocument({ data: content })`
    - Iterate pages, calling `page.getTextContent()` to extract text items in reading order
    - Detect headings by font-size heuristic: items with font size ≥ 1.2× the median body font size are treated as headings
    - Build `Section[]` from detected headings and their following text
    - Set `fullText`, `sourceUrl`, `format: 'pdf'`, `parsedAt`
    - _Requirements: 3.1, 3.3, 3.5_

  - [ ] 4.4 Implement `parsePlainText(content: string, url: string): Parsed_Policy` in `src/parser/text_parser.ts`
    - Split content on blank lines to get candidate blocks
    - Classify a line as a heading if it matches: ALL_CAPS (`/^[A-Z0-9\s\W]+$/`), ends with `:`, or is a short line (≤ 60 chars) preceded by a blank line
    - Build `Section[]` from heading lines and their following text blocks
    - Set `fullText`, `sourceUrl`, `format: 'text'`, `parsedAt`
    - _Requirements: 3.1, 3.4, 3.5_

  - [ ]* 4.5 Write property test for plain text heading detection
    - **Property 6: Plain Text Heading Detection**
    - **Validates: Requirements 3.4**
    - File: `tests/property/parser.property.test.ts`
    - Use `plainTextWithHeadingsArbitrary()` to generate plain text with known heading lines (ALL_CAPS, ends-with-colon, short-preceded-by-blank)
    - Assert every expected heading appears as a `Section.heading` in the parsed output

  - [ ] 4.6 Implement `parseDocument(raw: RawDocument): Promise<Parsed_Policy>` dispatcher in `src/parser/index.ts`
    - Dispatch to `parseHtml`, `parsePdf`, or `parsePlainText` based on `raw.format`
    - Throw `AnalysisError` with `code: 'PARSE_ERROR'`, `manualInputFallback: true` for unsupported formats or parse failures
    - _Requirements: 3.1, 3.8_

  - [ ] 4.7 Implement `serializeParsedPolicy` and `deserializeParsedPolicy` in `src/parser/index.ts`
    - `serializeParsedPolicy(p: Parsed_Policy): string` — returns `JSON.stringify(p)`
    - `deserializeParsedPolicy(json: string): Parsed_Policy` — returns `JSON.parse(json)` cast to `Parsed_Policy`; throws `AnalysisError` with `code: 'PARSE_ERROR'` on malformed JSON
    - _Requirements: 3.6_

  - [ ]* 4.8 Write property test for Parsed_Policy round-trip serialization
    - **Property 4: Parsed_Policy Round-Trip**
    - **Validates: Requirements 3.1, 3.5, 3.6, 3.7**
    - File: `tests/property/parser.property.test.ts`
    - Use `parsedPolicyArbitrary()` to generate arbitrary `Parsed_Policy` objects
    - Assert `deserializeParsedPolicy(serializeParsedPolicy(policy))` deep-equals the original

  - [ ]* 4.9 Write unit tests for the parser module
    - File: `tests/unit/parser/html_parser.test.ts`, `tests/unit/parser/pdf_parser.test.ts`, `tests/unit/parser/text_parser.test.ts`
    - Test: HTML parser extracts known section headings from a fixture HTML policy (Req 3.2)
    - Test: PDF parser extracts known text content from a fixture PDF policy (Req 3.3)
    - Test: plain text parser identifies ALL_CAPS, colon-terminated, and short-preceded-by-blank headings (Req 3.4)
    - Test: `parseDocument` returns `PARSE_ERROR` for binary content that is not a valid PDF (Req 3.8)
    - Test: `parseDocument` returns `Parsed_Policy` with empty `sections` for an empty document (Req 3.8)

- [ ] 5. Checkpoint — parser pipeline
  - Ensure all parser unit tests and property tests pass: `npx vitest --run tests/unit/parser tests/property/parser.property.test.ts tests/property/link_detection.property.test.ts tests/property/fetcher.property.test.ts`
  - Ask the user if any questions arise before proceeding to the AI Engine.

- [ ] 6. Implement the AI Engine Client
  - [ ] 6.1 Define the `LLMAdapter` interface and implement `SaulLMAdapter` in `src/ai_engine_client.ts`
    - Define `interface LLMAdapter { complete(systemPrompt: string, userMessage: string): Promise<string>; modelId: string; }`
    - Implement `SaulLMAdapter` that POSTs to `https://api-inference.huggingface.co/models/Equall/Saul-Instruct-v1` with the HuggingFace Inference API format, passing `Authorization: Bearer <apiKey>` header
    - Set `modelId` to `"Equall/Saul-Instruct-v1"`
    - Throw `AnalysisError` with `code: 'AI_UNAVAILABLE'`, `retryable: true` on HTTP 5xx or network failure
    - _Requirements: 4.1, 5.1_

  - [ ] 6.2 Implement `OpenAIAdapter` as the fallback LLM adapter
    - Implement `OpenAIAdapter` that POSTs to `https://api.openai.com/v1/chat/completions` with `model: "gpt-4o"`, `response_format: { type: "json_object" }`, and `Authorization: Bearer <apiKey>` header
    - Set `modelId` to `"gpt-4o"`
    - Apply the same token truncation logic: estimate tokens at 4 chars/token; truncate `fullText` at 100,000 tokens and append `"\n[TRUNCATED — policy text exceeded context limit]"`
    - Throw `AnalysisError` with `code: 'AI_UNAVAILABLE'`, `retryable: true` on HTTP 5xx or network failure
    - _Requirements: 4.7_

  - [ ] 6.3 Implement prompt construction and token budget management
    - Write `buildSystemPrompt(): string` returning the full system prompt from the design (risk level rules, ambiguity rules, deviation rules, plain-language instruction)
    - Write `buildUserMessage(parsed: Parsed_Policy): string` using the template: domain, policy URL, and `fullText` wrapped in `--- POLICY TEXT START ---` / `--- POLICY TEXT END ---` delimiters
    - Apply SaulLM token budget: estimate tokens at 4 chars/token; if estimated tokens > 28,000, truncate `fullText` and add `"Policy text was truncated due to length"` to `analysisWarnings`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ] 6.4 Implement JSON schema validation and `Risk_Analysis` assembly
    - Use `ajv` to compile and validate the LLM JSON response against the `Risk_Analysis` JSON schema defined in the design
    - After validation, derive `overallRiskLevel` as the maximum `riskLevel` across all `dataTypes` entries (or `"low"` if `dataTypes` is empty)
    - Assemble the full `Risk_Analysis` object by adding `schemaVersion: "1.0"`, `policyUrl`, `targetDomain`, `analyzedAt`, `modelUsed`
    - On JSON parse failure or schema validation failure, retry once with a correction prompt appended: `"Your previous response was not valid JSON matching the required schema. Please respond with only the JSON object."`; if still invalid, throw `AnalysisError` with `code: 'AI_INVALID_RESPONSE'`, `retryable: true`
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.7_

  - [ ]* 6.5 Write property test for Risk_Analysis structural invariants
    - **Property 7: Risk_Analysis Structural Invariants**
    - **Validates: Requirements 4.2, 4.5, 6.4, 6.6**
    - File: `tests/property/risk_analysis.property.test.ts`
    - Use `riskAnalysisArbitrary()` to generate arbitrary `Risk_Analysis` objects
    - Assert: all `riskLevel` values are `"low" | "medium" | "high"`, all `sharedWithThirdParties` are boolean, `overallRiskLevel` equals the computed maximum, and JSON round-trip is lossless

  - [ ]* 6.6 Write property test for Risk data provenance
    - **Property 8: Risk Data Provenance**
    - **Validates: Requirements 4.1**
    - File: `tests/property/risk_analysis.property.test.ts`
    - Use `parsedPolicyArbitrary()` and `fc.string()` for an alternate `sourceUrl`
    - Use a deterministic mock AI that returns the same output for the same `fullText`
    - Assert that two `Parsed_Policy` objects with identical `fullText` but different metadata produce equivalent `dataTypes` arrays

  - [ ]* 6.7 Write property test for Risk_Analysis completeness
    - **Property 9: Risk_Analysis Completeness**
    - **Validates: Requirements 4.6**
    - File: `tests/property/risk_analysis.property.test.ts`
    - Use `policyTextWithPersonalDataArbitrary()` to generate policy texts always containing at least one personal data keyword
    - Use a keyword-aware mock AI that returns non-empty `dataTypes` for known keywords
    - Assert `result.dataTypes.length > 0`

  - [ ] 6.8 Implement `analyzePolicy(parsed: Parsed_Policy): Promise<Risk_Analysis>` — the public entry point
    - Load the API key from `chrome.storage.local`; if absent, throw `AnalysisError` with `code: 'NO_API_KEY'`, `retryable: false`, `manualInputFallback: false`
    - Instantiate the configured adapter (`SaulLMAdapter` or `OpenAIAdapter`) with the stored key
    - Call `adapter.complete(systemPrompt, userMessage)`, validate, assemble, and return `Risk_Analysis`
    - _Requirements: 4.1, 5.1, 5.6_

  - [ ]* 6.9 Write property test for no outbound requests without API key
    - **Property 10: No Outbound Requests Without API Key**
    - **Validates: Requirements 5.6**
    - File: `tests/property/security.property.test.ts`
    - Use `parsedPolicyArbitrary()` with an empty mock storage (no API key)
    - Use a logging mock `fetch` that records all outbound URLs
    - Assert `requestLog.length === 0` after calling `analyzePolicy`

  - [ ]* 6.10 Write unit tests for the AI Engine Client
    - File: `tests/unit/ai_engine_client.test.ts`
    - Test: blocks analysis and returns `NO_API_KEY` error when storage is empty (Req 5.1)
    - Test: sends a test request during API key validation before saving (Req 5.3)
    - Test: does not save API key when validation returns 401 (Req 5.5)
    - Test: retries once with correction prompt on invalid JSON response (Req 4.7)
    - Test: returns `AI_UNAVAILABLE` error on HTTP 503 from AI endpoint (Req 4.7)
    - Test: produces `Risk_Analysis` with non-null `warningNote` for known vague language (Req 4.3)
    - Test: produces `Risk_Analysis` with non-null `deviationNote` for known broad access language (Req 4.4)

- [ ] 7. Implement the Background Service Worker
  - [ ] 7.1 Implement pipeline orchestration in `src/background.ts`
    - Implement `runAnalysisPipeline(input: { policyUrl: string } | { manualText: string }): Promise<Risk_Analysis>`
    - For `policyUrl` input: call `fetchDocument(policyUrl)` → `parseDocument(rawDoc)` → `analyzePolicy(parsed)`
    - For `manualText` input: call `wrapManualText(text)` → `parseDocument(rawDoc)` → `analyzePolicy(parsed)`
    - Store the result: `chrome.storage.local.set({ [policyUrl ?? 'manual']: analysis })`
    - _Requirements: 2.1, 2.4, 2.6, 3.1, 4.1_

  - [ ] 7.2 Implement message routing in `src/background.ts`
    - Listen for `POLICY_DETECTED`: store `Page_Metadata` in `chrome.storage.local`; send `SHOW_ALERT_POPUP` back to the originating tab
    - Listen for `INITIATE_ANALYSIS`: call `runAnalysisPipeline`; on success send `ANALYSIS_COMPLETE` with `Risk_Analysis`; on `AnalysisError` send `ANALYSIS_ERROR` with the error payload
    - Listen for `VALIDATE_API_KEY`: call `adapter.testApiKey(apiKey)`; on success encrypt and store the key, send `API_KEY_VALIDATION_RESULT { success: true }`; on failure send `API_KEY_VALIDATION_RESULT { success: false, error }`
    - _Requirements: 1.2, 1.4, 4.7, 5.3, 5.4, 5.5_

  - [ ]* 7.3 Write integration tests for the background pipeline
    - File: `tests/integration/pipeline.test.ts`
    - Test: full pipeline integration — mock fetch → real parser → mock AI → stored `Risk_Analysis` (Req 2.4)
    - Test: `ANALYSIS_ERROR` message sent to content script on fetch failure (Req 2.5)
    - Test: `ANALYSIS_COMPLETE` message sent with valid `Risk_Analysis` on success (Req 4.5)

- [ ] 8. Implement API Key Configuration
  - [ ] 8.1 Implement encrypted API key storage helpers in `src/background.ts` (or a dedicated `src/storage.ts`)
    - Write `encryptApiKey(key: string): string` using the Web Crypto API (`AES-GCM` with a device-bound key derived from `chrome.storage.session` or a fixed extension secret)
    - Write `decryptApiKey(encrypted: string): Promise<string>`
    - Write `saveApiKey(key: string): Promise<void>` — encrypts and stores in `chrome.storage.local` under key `"apiKey"`
    - Write `loadApiKey(): Promise<string | null>` — loads and decrypts; returns `null` if absent
    - _Requirements: 5.2_

  - [ ] 8.2 Implement `testApiKey(apiKey: string, adapterType: 'saulm' | 'openai'): Promise<void>` in `src/ai_engine_client.ts`
    - Instantiate the appropriate adapter with the provided key
    - Send a minimal test prompt (e.g., `"Respond with: {\"dataTypes\":[], \"analysisWarnings\":[]}"`); if the response is valid JSON, resolve; otherwise throw `AnalysisError` with `code: 'API_KEY_INVALID'`
    - Throw `AnalysisError` with `code: 'API_KEY_INVALID'` on HTTP 401/403
    - _Requirements: 5.3, 5.4, 5.5_

  - [ ] 8.3 Implement the Settings UI in `src/popup.ts`
    - Render an API key input field and a provider selector (`SaulLM / HuggingFace` or `OpenAI GPT-4o`)
    - On "Save" click: send `VALIDATE_API_KEY` message to background; display a spinner during validation
    - On `API_KEY_VALIDATION_RESULT { success: true }`: display "API key saved successfully"
    - On `API_KEY_VALIDATION_RESULT { success: false }`: display the error message; do not save the key
    - _Requirements: 5.1, 5.3, 5.4, 5.5_

  - [ ]* 8.4 Write unit tests for API key configuration
    - File: `tests/unit/ai_engine_client.test.ts` (extend existing file)
    - Test: `saveApiKey` stores an encrypted value (not the plaintext key) in `chrome.storage.local` (Req 5.2)
    - Test: `loadApiKey` returns `null` when no key is stored (Req 5.1)
    - Test: `testApiKey` resolves on a valid 200 response (Req 5.3)
    - Test: `testApiKey` throws `API_KEY_INVALID` on HTTP 401 (Req 5.5)

- [ ] 9. Checkpoint — full pipeline
  - Run the full test suite: `npx vitest --run`
  - Ensure all non-optional unit, integration, and property tests pass
  - Ask the user if any questions arise before proceeding to the smoke test.

- [ ] 10. End-to-end smoke test with a real privacy policy URL
  - [ ] 10.1 Write a Node.js smoke test script `tests/smoke/e2e_smoke.ts`
    - Accept a privacy policy URL as a CLI argument (e.g., `https://policies.google.com/privacy`)
    - Instantiate `fetchDocument`, `parseDocument`, and a real `SaulLMAdapter` (or `OpenAIAdapter`) using an API key from the `PRIVACY_TOOL_API_KEY` environment variable
    - Run the full pipeline and print the resulting `Risk_Analysis` JSON to stdout
    - Assert: `Risk_Analysis` passes `ajv` schema validation, `dataTypes` is non-empty, `overallRiskLevel` is one of `"low" | "medium" | "high"`, and `policyUrl` matches the input URL
    - Exit with code 0 on success, code 1 on any assertion failure or pipeline error
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 4.1, 4.5_

  - [ ] 10.2 Add a `smoke` script to `package.json`
    - `"smoke": "npx tsx tests/smoke/e2e_smoke.ts"` so the test can be run with `npm run smoke -- <url>`
    - Document the required `PRIVACY_TOOL_API_KEY` environment variable in `README.md`

- [ ] 11. Final checkpoint — all tests pass
  - Run `npx vitest --run` and confirm all non-optional tests pass
  - Verify the extension build completes without errors: `npm run build`
  - Ask the user if any questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP build
- Each task references specific requirements for traceability
- Checkpoints (tasks 5, 9, 11) ensure incremental validation at natural pipeline boundaries
- Property tests validate universal correctness properties across generated inputs; unit tests validate specific examples and edge cases
- The smoke test (task 10) requires a real API key and network access — it is not part of the automated CI suite
- Frontend Risk_Breakdown display is explicitly out of scope for this step; the `Risk_Analysis` JSON stored in `chrome.storage.local` is the deliverable
