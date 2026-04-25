# Technology Stack

## Build System

- **Bundler**: Vite 5.3.4
- **Language**: TypeScript 5.5.3 (strict mode enabled)
- **Target**: ES2020
- **Module System**: ESNext with bundler resolution

## Core Dependencies

- **@mozilla/readability** (0.5.0): HTML article extraction
- **pdfjs-dist** (4.4.168): PDF text extraction
- **ajv** (8.17.1): JSON schema validation for AI responses

## Development Dependencies

- **Vitest** (2.0.4): Test framework
- **fast-check** (3.21.0): Property-based testing library
- **jsdom** (24.1.0): DOM testing environment
- **tsx** (4.16.2): TypeScript execution for scripts

## Browser APIs

- Chrome Extension Manifest V3
- `chrome.storage.local`: Caching and API key storage
- `chrome.runtime`: Message passing between components
- `chrome.tabs`: Content script communication

## Common Commands

```bash
# Build for production
npm run build

# Development mode (watch for changes)
npm run dev

# Run all unit tests
npm test

# Run smoke tests (end-to-end)
npm run smoke
```

## Build Output

- **Output Directory**: `dist/`
- **Entry Points**: 
  - `background.js` (service worker)
  - `content_script.js` (injected into pages)
  - `popup.js` (settings UI)
- **Format**: ES modules (not minified for debugging)

## Path Aliases

- `@/*` maps to `src/*` (configured in tsconfig.json and vite.config.ts)
