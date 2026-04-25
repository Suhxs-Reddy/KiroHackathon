# Privacy Tool Extension - Setup Guide

## Quick Start for Testing

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd KiroHackathon
npm install
```

### 2. Build the Extension

```bash
npm run build
```

This creates a `dist/` folder with the compiled extension.

### 3. Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `dist/` folder from this project
5. The extension icon should appear in your toolbar

### 4. Get an API Key

**Option A: HuggingFace (Recommended for legal text)**
1. Go to https://huggingface.co/settings/tokens
2. Click **New token**
3. Name it (e.g., "privacy-tool")
4. Select **Fine-grained** token type
5. Under permissions, enable:
   - **Inference API** → Read access
6. Click **Generate token**
7. Copy the token (starts with `hf_...`)

**Option B: OpenAI (Faster, costs money)**
1. Go to https://platform.openai.com/api-keys
2. Create new API key
3. Copy the key (starts with `sk-...`)

### 5. Configure the Extension

1. Click the extension icon in Chrome toolbar
2. Select your AI provider:
   - **SaulLM (HuggingFace)** - Legal specialist, free, slower first request
   - **GPT-4o (OpenAI)** - General purpose, fast, costs ~$0.01 per analysis
3. Paste your API key
4. Click **Save & Validate**

**Important for HuggingFace users:**
- First validation takes 1-2 minutes (model cold start)
- If it says "model is loading", wait 60 seconds and try again
- Subsequent requests will be faster

### 6. Test the Extension

1. Visit any website with a privacy policy (e.g., https://www.reddit.com)
2. The extension should detect policy links automatically
3. A popup will appear asking if you want to analyze
4. Click **Analyze**
5. Wait for results (30-60 seconds for first HuggingFace request)

### 7. View Results

Open Chrome DevTools:
1. Right-click extension icon → **Inspect popup** (for settings UI logs)
2. Right-click page → **Inspect** → **Console** (for content script logs)
3. Go to `chrome://extensions/` → Click **service worker** under extension (for background logs)

Results are stored in `chrome.storage.local` - you can view them in DevTools:
```javascript
chrome.storage.local.get(null, console.log)
```

## Troubleshooting

### "Validation taking too long"
- **HuggingFace**: Model is loading (cold start). Wait 1-2 minutes and retry.
- **OpenAI**: Check your API key and network connection.

### "API key validation failed"
- **HuggingFace**: Make sure token has "Inference API" read permission
- **OpenAI**: Make sure you have credits in your account
- Check the background service worker console for detailed error logs

### Extension not detecting policies
- Check the page actually has privacy policy links
- Open DevTools console and look for `[PolicyDetector]` logs
- Try refreshing the page

### Build errors
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
npm run build
```

## Development Commands

```bash
# Run tests
npm test

# Development mode (auto-rebuild on changes)
npm run dev

# Build for production
npm run build
```

## Architecture

- **Content Script** (`src/content_script.ts`) - Scans pages for policy links
- **Background Worker** (`src/background.ts`) - Orchestrates analysis pipeline
- **Fetcher** (`src/fetcher.ts`) - Downloads policy documents
- **Parser** (`src/parser/`) - Extracts text from HTML/PDF/plain text
- **AI Engine** (`src/ai_engine_client.ts`) - Sends to AI and validates responses
- **Settings UI** (`src/popup.ts`) - API key configuration

## What Gets Analyzed

The extension extracts:
- Data types collected (location, email, browsing history, etc.)
- Risk levels (low/medium/high)
- Purposes for data collection
- Third-party sharing information
- Warning flags for vague or concerning language

## Privacy

- API keys stored locally in Chrome storage
- No data sent anywhere except your chosen AI provider
- Policy text sent to AI for analysis only
- Results cached locally

## Next Steps

After testing, you can:
1. Try different websites
2. Compare SaulLM vs GPT-4o results
3. Check the Risk_Analysis JSON structure in storage
4. Report any bugs or issues
