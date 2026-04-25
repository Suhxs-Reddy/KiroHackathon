<p align="center">
  <img src="DataGuard/icons/icon128.png" alt="DataGuard Logo" width="80" />
</p>

<h1 align="center">DataGuard</h1>

<p align="center">
  <strong>Know what you're agreeing to — before you agree.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/chrome-MV3-blue?logo=googlechrome&logoColor=white" alt="Chrome MV3" />
  <img src="https://img.shields.io/badge/typescript-5.5-blue?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/AI-Llama%203.1%208B-purple?logo=meta&logoColor=white" alt="Llama 3.1" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
  <img src="https://img.shields.io/badge/built%20with-Kiro-orange" alt="Built with Kiro" />
</p>

<p align="center">
  DataGuard is a Chrome extension that reads any website's privacy policy using AI, shows you exactly what data is being collected, checks if the site has been breached, and helps you opt out — all in one click.
</p>

---

## What It Does

- **Reads the actual privacy policy** — not just metadata. AI analyzes the full legal text and extracts what matters.
- **Shows you a plain-language risk breakdown** — data types, purposes, third-party sharing, and risk levels at a glance.
- **Checks breach history** — queries the Have I Been Pwned database so you know if a site has leaked data before.
- **Helps you opt out** — one-click URL opening, pre-filled opt-out emails, and calendar reminders for follow-ups.

---

## Key Features

### 🤖 AI-Powered Privacy Policy Analysis

DataGuard fetches the full privacy policy text, sends it to a legal-aware LLM (Llama 3.1 8B via HuggingFace), and returns a structured breakdown of every data type collected — with risk levels, purposes, and third-party sharing disclosures. No more reading 5,000-word legal documents.

### 🏷️ Apple-Style Privacy Labels

A visual grid inspired by Apple's App Store privacy labels. See at a glance across 14 data categories — Health, Financial, Location, Contacts, Browsing, Identifiers, and more — what's collected, what's shared, and what's sold.

### 🚪 Opt-Out Automation

For every data type with an opt-out mechanism, DataGuard gives you action buttons:
- **Settings URLs & web forms** → one-click opens in a new tab
- **Email opt-outs** → pre-filled email with your domain, data type, and privacy regulation references (GDPR, CCPA)
- **Postal mail** → downloadable `.ics` calendar reminder so you don't forget to send the letter
- **Follow-up reminders** → schedule a 14-day check to verify your opt-out was processed

### 🔓 Breach History

Checks the [Have I Been Pwned](https://haveibeenpwned.com/) database for the current site. See the number of breaches, dates, types of data exposed, and affected accounts — before you hand over your information.

### 🔍 Real-Time Page Scanning

The content script scans every page you visit for data input fields (email, password, credit card, address) and classifies them by sensitivity. You see what data the page is asking for right now, not just what the policy says.

---

## Screenshots

> 📸 **Screenshots coming soon** — the extension is fully functional and ready for demo.

---

## Quick Start

### 1. Clone and build

```bash
git clone <repo-url>
cd dataguard
npm install
npm run build
```

### 2. Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the **root project folder** (the one containing `manifest.json`)

### 3. Get a HuggingFace API key

1. Go to [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
2. Create a new token with **Inference** permissions
3. Click the DataGuard icon in Chrome → **Settings** → paste your key → **Save & Validate**

### 4. Use it

Navigate to any website. Click the DataGuard icon to see:
- What data the page collects
- Breach history for the domain
- AI analysis of the privacy policy (click "Analyze Privacy Policy")
- Opt-out actions for each data type

---

## How It Works

```
┌──────────────┐     ┌──────────────────┐     ┌────────────┐     ┌──────────────┐
│  You visit   │────▶│  Content Script   │────▶│ Background │────▶│  AI Engine   │
│  a website   │     │  scans the page   │     │  Worker    │     │  (Llama 3.1) │
└──────────────┘     └──────────────────┘     └────────────┘     └──────────────┘
                        │                         │                     │
                        │ Detects policy links    │ Fetches policy      │ Analyzes text
                        │ Scans input fields      │ Parses HTML/PDF     │ Extracts risks
                        │ Checks HIBP breaches    │ Routes messages     │ Finds opt-outs
                        │                         │                     │
                        ▼                         ▼                     ▼
                   ┌──────────────────────────────────────────────────────────┐
                   │              DataGuard Popup UI                          │
                   │  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌─────────────┐  │
                   │  │ Fields  │ │ Breaches │ │ AI Risk │ │  Opt-Out    │  │
                   │  │ Detected│ │ History  │ │ Analysis│ │  Actions    │  │
                   │  └─────────┘ └──────────┘ └─────────┘ └─────────────┘  │
                   └──────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Language** | TypeScript 5.5 (strict mode) |
| **Bundler** | Vite 5.3 |
| **Extension** | Chrome Manifest V3 |
| **AI Model** | Llama 3.1 8B Instruct via [HuggingFace Inference Providers API](https://huggingface.co/docs/inference-providers) |
| **Breach Data** | [Have I Been Pwned API](https://haveibeenpwned.com/API/v3) |
| **HTML Parsing** | Mozilla Readability |
| **Testing** | Vitest + fast-check (property-based testing) |
| **Storage** | `chrome.storage.local` (all data stays on your machine) |

---

## Privacy

DataGuard is built with a privacy-first philosophy:

- **No tracking.** Zero analytics, no telemetry, no usage data collected.
- **Local storage only.** All settings, cached analyses, and action history stay in your browser's local storage.
- **No data sent anywhere** except to the AI provider you explicitly configure (HuggingFace or OpenAI) — and only the privacy policy text, never your personal data.
- **You control the API key.** Your key, your provider, your choice. Remove it anytime.
- **Open source.** Every line of code is auditable.

---

## Built with Kiro

This project was built using [Kiro](https://kiro.dev), an AI-powered development environment by Amazon.

We used Kiro's full feature set throughout the build:

- **Spec-Driven Development** — Created 4 formal specs using Kiro's Requirements → Design → Tasks workflow, each with formal correctness properties for property-based testing
- **Steering Files** — Workspace-level steering files (`tech.md`, `structure.md`, `product.md`) guided Kiro's code generation to match our conventions
- **Hooks** — Automated workflows for generating technical reports
- **AI-Powered Debugging** — Kiro helped us solve MV3 service worker crashes, HuggingFace API migration, and complex multi-file integration
- **Real-Time Pair Programming** — One person tested in Chrome while Kiro fixed issues in real-time

See [DOCUMENTATION.md](./DOCUMENTATION.md) for the full story of how we used Kiro.

---

## Team

Built during a hackathon by:

| Role | Focus |
|---|---|
| **Product + Spec Lead** | Overall concept, Kiro specs, coordination |
| **Frontend + Integration** | Browser extension UI, policy detection, opt-out pipeline |
| **Backend + AI** | AI analysis engine, structured extraction, reminder scheduler |

---

## License

[MIT](./LICENSE)
