# PrivacyTool — Concept Document

> **Hackathon Theme:** Ethics & Privacy
> **Status:** Draft v0.4 — Final scoped concept
> **Goal:** Top project + all 4 prize signals ($1,500 each)

---

## 1. One-Line Pitch

A browser extension that reads any website's privacy policy, extracts exactly what data is being collected and why, automates opt-outs where possible, and reminds users when action is needed — so privacy stops being something you ignore and starts being something that works for you.

---

## 2. The Core Idea

Most people have no idea what they agreed to. Privacy policies are long, written in legal language, and buried. Even people who want to opt out don't know how — or give up when the process is unclear.

PrivacyTool makes the invisible visible. As you browse, it reads the privacy policy of every site you visit, extracts structured risk data using an LLM, and tells you in plain language:

- **What data** is being collected (location, browsing history, device info, contacts, etc.)
- **What it's used for** (ad targeting, third-party selling, product analytics, etc.)
- **Who it's shared with** (advertisers, data brokers, government, etc.)
- **What's at risk** and how serious it is

Then it acts. Where opt-out can be automated (email requests, form submissions), the extension does it. Where physical action is needed, it creates a reminder with exact steps.

---

## 3. Problem Statement

- Privacy policies are unreadable — average length is 2,500 words, written for lawyers not users
- Most people don't know what data is being collected or what it's actually used for
- Opt-out processes are deliberately obscure — buried forms, broken links, email addresses that don't respond
- Even motivated users give up because the process requires too many steps across too many sites
- Nobody revisits — policies change, new data collection is added, and users never find out

**The friction points this tool removes:**
- Confusion → LLM translates policy into structured, plain-language risk breakdown
- Effort → Extension automates opt-outs wherever possible
- Forgetting → Reminders for manual actions + policy change alerts

---

## 4. Target Users

### Casual Users
- Don't read privacy policies, don't know what they've agreed to
- Want to understand what's happening to their data without effort
- Need the tool to act for them — minimal input required
- UX: clean, readable, no alert fatigue

### Power Users
- Already privacy-conscious, want visibility across all sites they visit
- Want to see aggregated risk across their browsing history
- Want full control over opt-out actions and reminder schedules
- UX: full detail available on demand, exportable data

---

## 5. Core Features

### 5.1 Privacy Policy Scanner (LLM-Powered)

**What it does:**
When a user visits any website, the extension detects the privacy policy URL, fetches the content, and sends it to an LLM for structured extraction.

**What the LLM extracts (structured output, not just a summary):**
```
{
  "site": "example.com",
  "data_collected": [
    { "type": "location", "granularity": "precise", "purpose": "ad targeting" },
    { "type": "browsing_history", "purpose": "third-party selling" },
    { "type": "device_identifiers", "purpose": "cross-site tracking" }
  ],
  "third_party_sharing": ["Google Ads", "Meta Pixel", "data brokers"],
  "opt_out_available": true,
  "opt_out_method": "email_request",
  "opt_out_contact": "privacy@example.com",
  "risk_level": "high",
  "risk_reasons": ["sells data to brokers", "precise location tracking", "no data deletion option"]
}
```

**The edge over basic LLM summarization:**
Structured extraction means the output powers everything else — the dashboard, the Ethics Logic Gate, the automated opt-out, the reminders. It's not just readable text, it's actionable data.

**Display in extension popup:**
- Risk level badge (Low / Medium / High) visible immediately
- Expandable breakdown: data types, usage, third-party sharing
- Plain-language risk explanation: "This site sells your browsing history to data brokers"
- Opt-out status and action button

### 5.2 Automated Opt-out + Action Reminders

**Automated (extension handles it):**
- Email opt-out requests — extension drafts and sends the opt-out email to the site's privacy contact
- Form submissions — extension fills and submits opt-out forms on the site
- Cookie consent — extension sets privacy-maximizing options on consent banners

**Manual (reminder created):**
- When opt-out requires physical action (mailing a letter, calling a number, visiting an office)
- Extension creates a reminder with exact steps: what to do, where to go, what to say
- Reminder sent via email on a schedule until the user marks it complete

**Ethics Logic Gate:**
Before any automated action, the gate checks:
- Is this action reversible?
- Does this match what the user has consented to the tool doing?
- Is the opt-out contact legitimate (not a phishing risk)?
If any check fails, the action is blocked and the user is notified with an explanation.

### 5.3 Per-Site Privacy Dashboard

**Per-site view (default):**
- Risk level + breakdown for the current or any previously visited site
- Data types collected, usage, third-party sharing
- Opt-out status: automated ✓, pending manual action, not available
- Policy last checked date + change indicator

**Aggregate view (on demand):**
- All sites visited, sorted by risk level
- Total data types being collected across all sites
- Pending opt-out actions across all sites
- Overall privacy health score

**Design principle:** Per-site by default — don't overwhelm. Aggregate is one tap away for users who want it.

### 5.4 Email Reminders

**Triggered by:**
- Pending manual opt-out not completed within user-set timeframe (default: 7 days)
- Detected change in a site's privacy policy since last scan
- Periodic re-scan reminder for high-risk sites (default: 90 days)

**Email content:**
- Which site, what changed or what's pending
- Plain-language summary of the risk
- Direct link back to the relevant section of the dashboard
- One-click action where possible

**User customization:**
- Default schedules set automatically based on risk level
- User can override per site or globally
- Can pause reminders for a site if they've accepted the risk

---

## 6. Ethics Logic Gate

The hackathon requirement — and the technical centerpiece of the demo.

### What it is
A validation layer that runs before every automated action the tool takes. It checks three things:
1. **Consent** — has the user authorized this type of action?
2. **Safety** — is the action reversible and non-harmful?
3. **Legitimacy** — is the target (email address, form, URL) verified as belonging to the site?

### What it blocks
- Sending opt-out emails to unverified addresses
- Submitting forms on pages that don't match the site's known domain
- Taking any action the user hasn't explicitly enabled in settings
- Automated actions on sites the user has marked as "accepted risk"

### What judges see in the demo
The gate fires visually — a blocked action shows exactly why it was stopped and what the user can do instead. It's not a warning, it's a hard stop with an explanation.

---

## 7. Technical Architecture

### Browser Extension (Chrome v1)
- Detects page load, finds privacy policy link
- Fetches policy text, sends to backend for LLM processing
- Displays structured results in popup
- Handles automated opt-out actions (email, form, cookie consent)
- Ethics Logic Gate runs client-side before every action

### LLM Integration
- Policy text → structured JSON extraction prompt
- Model: GPT-4o or Claude 3.5 Sonnet via API (fast, reliable, no training needed)
- Prompt engineered for consistent structured output
- Cached per site + policy version to avoid redundant API calls

### Web Dashboard (Frontend)
- React SPA
- Per-site and aggregate privacy views
- Opt-out status tracking
- Reminder settings and history

### Backend
- Policy fetch + LLM processing endpoint
- Per-user site history and opt-out status store
- Reminder scheduler (time-based + change-detection triggered)
- Policy change detection: re-scan on interval, diff against stored version

### Notification Layer
- Email (v1): SendGrid / Postmark
- Triggered by scheduler or policy change detection

---

## 8. Team Split

| Person | Role | Owns |
|---|---|---|
| **Design** | UI/UX | Extension popup, dashboard, risk visualization, demo flow |
| **Frontend + Integration** | Core functionality | Extension logic, policy detection, automated opt-out, Ethics Logic Gate |
| **Backend + AI** | Infrastructure + LLM | Backend API, LLM prompt engineering, structured extraction, reminder scheduler |

---

## 9. Judging Rubric Alignment

| Criteria | How PrivacyTool scores |
|---|---|
| **Potential Value (10pts)** | Works on every website with a privacy policy — not limited to one platform. Real problem every internet user faces. Accessible to non-technical users. |
| **Implementation (10pts)** | LLM structured extraction (not just summarization), Ethics Logic Gate as real running code, automated opt-out pipeline, reminder scheduler — all demonstrable. |
| **Quality & Design (10pts)** | Clean per-site popup, no alert fatigue, risk level immediately visible. Delight moment: gate blocking an unsafe action with a clear explanation. |

### Prize Signal Strategy

| Prize | Strategy |
|---|---|
| **Build ($1,500)** | LLM structured extraction pipeline + Ethics Logic Gate as technical centerpiece. Show Kiro spec → architecture → working code. |
| **Collaboration ($1,500)** | Clear 3-way role split. Design owns the visual language. Dev owns the gate and automation. Backend owns the AI pipeline. |
| **Impact ($1,500)** | Works on any site, any user, no setup beyond installing the extension. Real customer journey: install → visit site → understand risk → opt out automatically. |
| **Story ($1,500)** | Demo moment: visit a site, watch the policy get scanned, see the risk breakdown appear, watch the gate block an unsafe opt-out attempt. "This is what privacy that actually works looks like." |

---

## 10. Demo Script (Hackathon Presentation)

1. **Hook (30s):** "You've visited hundreds of websites this week. Do you know what any of them are doing with your data? Neither do most people — because privacy policies are written to be ignored."
2. **Install + visit a site (30s):** Open a real website. Extension popup appears with risk badge.
3. **Risk breakdown (1min):** Show what data is collected, what it's used for, who it's shared with. Plain language. Real data from the actual policy.
4. **Automated opt-out (30s):** Click opt-out. Extension drafts and sends the email. Gate checks it first — shows the validation happening.
5. **Gate fires (30s):** Try an action on a site with an unverified privacy contact. Gate blocks it. Explains why. Suggests manual alternative.
6. **Dashboard (30s):** Show aggregate view — all sites visited this session, risk levels, pending actions.
7. **Close (30s):** "Every site. Every policy. Automatically. That's PrivacyTool."

---

## 11. Build Roadmap

### Hackathon MVP (what to demo)
- [ ] Extension: privacy policy detection + fetch on page load
- [ ] LLM: structured extraction prompt + JSON output (data types, usage, sharing, risk, opt-out method)
- [ ] Extension popup: risk badge, plain-language breakdown, opt-out button
- [ ] Automated opt-out: email draft + send for sites with email opt-out
- [ ] Ethics Logic Gate: consent + safety + legitimacy checks before every action
- [ ] Dashboard: per-site view with risk breakdown and opt-out status
- [ ] Email reminder: triggered for pending manual opt-outs

### Post-Hackathon v1
- Policy change detection + triggered reminders
- Cookie consent automation
- Aggregate dashboard view
- Firefox support
- User-customizable reminder schedules

### v2
- Expanded opt-out automation (form submissions)
- Data broker removal tracking
- Import/export privacy profile
- Power user mode

---

## 12. Out of Scope (Hackathon)

- OAuth account connections (Google, Meta, Apple) — not needed, extension works on any site
- Mobile app
- SMS/push notifications — email only
- Training a custom model — LLM API calls only
- Data broker removal tracking

---

*Last updated: Draft v0.4 — Final scoped concept*
