# Privacy Tool - Browser Extension

A Manifest V3 browser extension that automatically detects privacy policies on web pages, analyzes them using AI, and identifies data collection risks.

## ✅ Status: Core Pipeline Complete

**What's Working:**
- ✅ Policy link detection on any webpage
- ✅ Document fetching (HTML/PDF/text) with redirect handling
- ✅ Parsing with section extraction
- ✅ AI Engine Client with SaulLM-7B (HuggingFace) + GPT-4o fallback
- ✅ Background service worker orchestrating the full pipeline
- ✅ Settings UI for API key configuration
- ✅ 20 unit tests passing

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the Extension

```bash
npm run build
```

### 3. Load in Chrome/Edge

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the **root directory** of this project (the folder containing `manifest.json`)

### 4. Configure API Key

1. Click the extension icon in your browser toolbar
2. Choose your AI provider:
   - **SaulLM / HuggingFace** (Recommended): Legal-specialized model
   - **OpenAI GPT-4o**: General-purpose fallback
3. Enter your API key
4. Click "Save & Validate"

**Getting API Keys:**
- HuggingFace: https://huggingface.co/settings/tokens
- OpenAI: https://platform.openai.com/api-keys

### 5. Test It

1. Navigate to any website with a privacy policy (e.g., https://policies.google.com/privacy)
2. The extension will detect the policy link and show an alert popup
3. Click "Analyze" to run the full pipeline
4. Results are stored in `chrome.storage.local` (UI display pending)

## 📁 Project Structure

```
src/
├── types.ts              # TypeScript interfaces
├── content_script.ts     # DOM scanning, policy detection
├── background.ts         # Pipeline orchestration
├── fetcher.ts            # Document retrieval
├── ai_engine_client.ts   # AI analysis
├── popup.ts              # Settings UI
└── parser/
    ├── index.ts          # Parser dispatcher
    ├── html_parser.ts    # HTML extraction (Readability)
    ├── pdf_parser.ts     # PDF extraction (pdf.js)
    └── text_parser.ts    # Plain text extraction

tests/
├── unit/                 # Unit tests (20 passing)
├── property/             # Property-based tests (optional)
├── integration/          # Integration tests
└── smoke/                # End-to-end smoke tests

public/
└── popup.html            # Settings UI HTML

dist/                     # Build output
```

## 🧪 Testing

### Run All Tests

```bash
npm test
```

### Run Smoke Test (End-to-End)

Requires a real API key:

```bash
export PRIVACY_TOOL_API_KEY="your-api-key-here"
npm run smoke -- https://policies.google.com/privacy
```

## 🛠️ Development

### Watch Mode

```bash
npm run dev
```

Rebuilds automatically when source files change.

### Tech Stack

- **TypeScript 5.5.3** (strict mode)
- **Vite 5.3.4** (bundler)
- **Vitest 2.0.4** (test framework)
- **fast-check 3.21.0** (property-based testing)
- **@mozilla/readability** (HTML parsing)
- **pdfjs-dist** (PDF parsing)
- **ajv** (JSON schema validation)

## 📊 AI Models

### SaulLM-7B-Instruct (Recommended)

- **Provider**: HuggingFace Inference API
- **Specialization**: Legal documents (privacy policies, ToS, GDPR/CCPA text)
- **Context Window**: 32k tokens
- **Accuracy**: Understands legal terms like "legitimate interest", "data controller", "onward transfer"

### GPT-4o (Fallback)

- **Provider**: OpenAI
- **Specialization**: General-purpose
- **Context Window**: 128k tokens
- **Use Case**: When HuggingFace is unavailable or user prefers OpenAI

## 📝 Output Contract

The extension produces a `Risk_Analysis` JSON object stored in `chrome.storage.local`:

```typescript
interface Risk_Analysis {
  schemaVersion: string;
  policyUrl: string;
  targetDomain: string;
  analyzedAt: string;
  overallRiskLevel: 'low' | 'medium' | 'high';
  dataTypes: DataTypeEntry[];
  analysisWarnings: string[];
  modelUsed: string;
}

interface DataTypeEntry {
  dataType: string;              // e.g., "location data"
  riskLevel: 'low' | 'medium' | 'high';
  purposes: string[];            // Stated purposes
  sharedWithThirdParties: boolean;
  thirdPartyCategories: string[];
  warningNote: string | null;    // Flags ambiguous language
  deviationNote: string | null;  // Flags unusual data access
}
```

## 🚧 Known Limitations

- **Risk Breakdown UI**: Not yet implemented (Step 1 deliverable is the JSON contract)
- **API Key Storage**: Currently plaintext (production would use Web Crypto API encryption)
- **PDF Parsing**: Relies on font-size heuristics for heading detection
- **Property-Based Tests**: Defined but not implemented (optional for MVP)

## 📚 Spec Documentation

Full spec available in `.kiro/specs/policy-detection-risk-identification/`:
- `requirements.md` - 6 requirements covering the pipeline
- `design.md` - Architecture, data models, AI prompt design, 10 correctness properties
- `tasks.md` - 11 implementation tasks (Tasks 1-8 complete)

## 🎯 Next Steps

1. Implement Risk_Breakdown display UI (frontend)
2. Add property-based tests for 10 correctness properties
3. Implement API key encryption (Web Crypto API)
4. Add integration tests for background pipeline
5. Create smoke test with real privacy policy URLs

## 📄 License

MIT

## 🤝 Contributing

This is a hackathon project. Contributions welcome!

---

**Built with Kiro** - AI-powered development environment
