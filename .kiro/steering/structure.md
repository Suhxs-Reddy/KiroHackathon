# Project Structure

## Directory Layout

```
src/
├── types.ts              # TypeScript interfaces and type definitions
├── content_script.ts     # DOM scanning, policy detection, UI injection
├── background.ts         # Pipeline orchestration, message routing
├── fetcher.ts            # Document retrieval with redirect resolution
├── ai_engine_client.ts   # AI analysis and response validation
├── popup.ts              # Settings UI logic
└── parser/
    ├── index.ts          # Parser dispatcher (routes by format)
    ├── html_parser.ts    # HTML extraction using Readability
    ├── pdf_parser.ts     # PDF extraction using pdf.js
    └── text_parser.ts    # Plain text extraction

tests/
├── unit/                 # Unit tests (mirror src/ structure)
├── property/             # Property-based tests (optional)
├── integration/          # Integration tests
└── smoke/                # End-to-end smoke tests

public/
└── popup.html            # Settings UI HTML

dist/                     # Build output (generated)
```

## Architecture Pattern

**Message-Driven Pipeline**: Content script → Background worker → Fetcher → Parser → AI Engine

### Component Responsibilities

- **Content Script**: Runs on all pages; detects policy links and consent dialogs; injects alert popup
- **Background Worker**: Service worker; orchestrates fetch → parse → analyze pipeline; routes messages
- **Fetcher**: Retrieves documents; handles redirects; determines format from MIME type
- **Parser Module**: Extracts structured text from HTML/PDF/plain text
- **AI Engine Client**: Sends policy text to AI; validates JSON responses with Ajv

### Data Flow

1. Content script scans DOM for policy links
2. Sends `POLICY_DETECTED` message to background
3. Background stores metadata and sends `SHOW_ALERT_POPUP` back
4. User clicks "Analyze" → `INITIATE_ANALYSIS` message
5. Background runs pipeline: fetch → parse → AI analyze → cache
6. Sends `ANALYSIS_COMPLETE` or `ANALYSIS_ERROR` to content script

## File Naming Conventions

- **Source files**: `snake_case.ts` (e.g., `content_script.ts`, `ai_engine_client.ts`)
- **Test files**: `{filename}.test.ts` (e.g., `fetcher.test.ts`)
- **Types**: PascalCase for interfaces (e.g., `PolicyLink`, `Risk_Analysis`)
- **Functions**: camelCase (e.g., `scanDomForPolicyLinks`, `fetchDocument`)

## Code Organization Patterns

- **Section Comments**: Use ASCII art separators for major sections:
  ```typescript
  // ─── Task 7.1: Pipeline Orchestration ─────────────────────────────────────
  ```
- **Error Handling**: Use custom `AnalysisError` class with error codes
- **Type Safety**: Strict TypeScript; all functions have explicit return types
- **Message Types**: Union type `ExtensionMessage` for all chrome.runtime messages
- **Async/Await**: Preferred over promises; all async functions return typed promises

## Testing Structure

- **Unit tests**: Test individual functions in isolation
- **Mocking**: Use Vitest's `vi.fn()` for mocking browser APIs and fetch
- **DOM Testing**: Use jsdom for content script tests
- **Test Organization**: Mirror source file structure in `tests/unit/`
- **Test Naming**: Descriptive with requirement references (e.g., `'detects policy links (Req 1.1)'`)
